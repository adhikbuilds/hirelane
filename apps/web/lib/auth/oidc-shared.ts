import { createHash, createPublicKey, createVerify, randomBytes, timingSafeEqual, type JsonWebKey } from "node:crypto";
import { clearOidcCookie, cookieName, oidcCookie, OIDC_COOKIE, pendingCookie, readCookie, serializeCookie, sessionCookie, sessionCookieName, type CookieSpec } from "./cookies";
import { hmac } from "@hirelane/vault";
import { checkRateLimit, clientIp, guardedLimit, scaledLimit, trustProxyHops } from "../rate-limit";
import { appOrigin } from "./origin";
import { createPendingSignup, PENDING_TTL_MS } from "./pending-signup";
import { resolveIdentity, SESSION_MAX_AGE_SECONDS, signPayload, startSession, verifyPayload, type AuthDeps, type Provider } from "./session";

/**
 * OpenID Connect authorization-code flow shared by the Google and LinkedIn routes, built on node:crypto.
 * No OIDC library: RS256 verification is a few lines and the audit surface stays small.
 * Tests use a local mock issuer behind an injected fetch; nothing here ever calls a live provider from a test.
 */
export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** What differs per provider. Everything else (state, nonce, JWKS, rate limit, account resolution) is one code path. */
export interface OidcSpec {
  provider: Extract<Provider, "google" | "linkedin">;
  scope: string;
  /** Extra authorize-URL params (Google asks for the account chooser). */
  extraAuthParams?: Record<string, string>;
  /** Issuer strings besides config.issuer that an ID token (or the discovery document) may carry. */
  altIssuers?: (config: OidcConfig) => string[];
  /** "always": PKCE S256 on every start. "if-advertised": only when discovery lists S256, else state + nonce + client secret. */
  pkce: "always" | "if-advertised";
  /** Rate-limit key prefix and the per-10-minute cap for /start. */
  limitKey: string;
  limit: number;
  /** The /signin?error=<this> code. */
  errorCode: string;
}

export function isPublicHttps(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && url.hostname !== "[::1]";
  } catch {
    return false;
  }
}

const OIDC_STATE_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 60;
const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = 5000;

export interface Endpoints {
  authorization: string;
  token: string;
  jwks: string;
  /** Discovery lists S256 in code_challenge_methods_supported. */
  pkceS256: boolean;
}

/** https only, with http allowed for localhost so a dev issuer works. Endpoints come from config, never from users. */
function safeUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "https:" || (url.protocol === "http:" && local) ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function getJson(f: typeof fetch, url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await f(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  const text = await res.text();
  if (text.length > MAX_BODY) throw new Error("oidc: response too large");
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const discoveryCache = new WeakMap<typeof fetch, Map<string, { at: number; endpoints: Endpoints }>>();

/** Discovery is cached for an hour per issuer, so /start does not fan out one outbound fetch per hit. */
export async function discover(config: OidcConfig, f: typeof fetch, nowMs: number = Date.now(), altIssuers: string[] = []): Promise<Endpoints> {
  let byIssuer = discoveryCache.get(f);
  if (!byIssuer) discoveryCache.set(f, (byIssuer = new Map()));
  const hit = byIssuer.get(config.issuer);
  if (hit && nowMs - hit.at >= 0 && nowMs - hit.at < DISCOVERY_TTL_MS) return hit.endpoints;
  const endpoints = await discoverUncached(config, f, altIssuers);
  byIssuer.set(config.issuer, { at: nowMs, endpoints });
  return endpoints;
}

async function discoverUncached(config: OidcConfig, f: typeof fetch, altIssuers: string[]): Promise<Endpoints> {
  const { status, body } = await getJson(f, `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  const doc = body as Record<string, unknown> | null;
  if (status !== 200 || !doc || typeof doc["issuer"] !== "string" || ![config.issuer, ...altIssuers].includes(doc["issuer"])) throw new Error("oidc: bad discovery document");
  const authorization = safeUrl(doc["authorization_endpoint"]);
  const token = safeUrl(doc["token_endpoint"]);
  const jwks = safeUrl(doc["jwks_uri"]);
  if (!authorization || !token || !jwks) throw new Error("oidc: discovery endpoints missing");
  const methods = doc["code_challenge_methods_supported"];
  return { authorization, token, jwks, pkceS256: Array.isArray(methods) && methods.includes("S256") };
}

// ---------- ID token ----------

export type IdTokenResult = { ok: true; sub: string; email: string; name?: string } | { ok: false };

const fail: IdTokenResult = { ok: false };

function parseJwt(token: string): { header: Record<string, unknown>; claims: Record<string, unknown>; signingInput: string; signature: Buffer } | null {
  if (typeof token !== "string" || token.length > 8192) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p)) || !parts[0] || !parts[1] || !parts[2]) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof header !== "object" || header === null || typeof claims !== "object" || claims === null) return null;
    return { header, claims, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2], "base64url") };
  } catch {
    return null;
  }
}

/**
 * Signature (RS256 only), issuer, audience, expiry, issued-at, nonce and verified email. Anything off returns {ok:false}.
 * `name` is returned only when `withName` is set, trimmed, control characters removed, at most 200 characters.
 */
export async function verifyOidcIdToken(
  idToken: string,
  opts: { config: OidcConfig; fetch: typeof fetch; nonce: string; now: Date; jwksUri?: string; issuers: string[]; withName?: boolean; altDiscoveryIssuers?: string[] },
): Promise<IdTokenResult> {
  try {
    const jwt = parseJwt(idToken);
    if (!jwt) return fail;
    if (jwt.header["alg"] !== "RS256") return fail; // never "none", never HS*: the key is not a shared secret
    const kid = jwt.header["kid"];
    if (typeof kid !== "string") return fail;

    const jwksUri = opts.jwksUri ?? (await discover(opts.config, opts.fetch, Date.now(), opts.altDiscoveryIssuers)).jwks;
    const { status, body } = await getJson(opts.fetch, jwksUri);
    const keys = (body as { keys?: (JsonWebKey & { kid?: string })[] } | null)?.keys;
    if (status !== 200 || !Array.isArray(keys)) return fail;
    const jwk = keys.find((k) => k.kid === kid && k.kty === "RSA");
    if (!jwk) return fail;
    const verifier = createVerify("RSA-SHA256").update(jwt.signingInput);
    if (!verifier.verify(createPublicKey({ key: jwk, format: "jwk" }), jwt.signature)) return fail;

    const c = jwt.claims;
    const t = Math.floor(opts.now.getTime() / 1000);
    if (typeof c["iss"] !== "string" || !opts.issuers.includes(c["iss"])) return fail;
    const aud = c["aud"];
    const audOk = typeof aud === "string" ? aud === opts.config.clientId : Array.isArray(aud) && aud.includes(opts.config.clientId) && c["azp"] === opts.config.clientId;
    if (!audOk) return fail;
    if (typeof c["exp"] !== "number" || c["exp"] + CLOCK_SKEW_S <= t) return fail;
    if (typeof c["iat"] !== "number" || c["iat"] - CLOCK_SKEW_S > t) return fail;
    if (typeof c["nonce"] !== "string" || !safeEqual(c["nonce"], opts.nonce)) return fail;
    if (typeof c["sub"] !== "string" || !c["sub"] || c["sub"].length > 255) return fail;
    if (typeof c["email"] !== "string" || !c["email"] || c["email"].length > 254) return fail;
    if (c["email_verified"] !== true && c["email_verified"] !== "true") return fail;
    const out: IdTokenResult = { ok: true, sub: c["sub"], email: c["email"].trim().toLowerCase() };
    if (opts.withName && typeof c["name"] === "string") {
      // eslint-disable-next-line no-control-regex
      const name = c["name"].replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
      if (name) out.name = name;
    }
    return out;
  } catch {
    return fail;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- route logic ----------

export interface OidcRouteCtx {
  deps: AuthDeps;
  config: OidcConfig | null;
  fetch: typeof fetch;
  enabled: () => Promise<boolean>;
}

const STATE_PURPOSE = "auth/oidc-state";
const noStore = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

function respond(status: number, headers: Record<string, string>, cookies: CookieSpec[] = []): Response {
  const h = new Headers({ ...noStore, ...headers });
  for (const c of cookies) h.append("set-cookie", serializeCookie(c));
  return new Response(null, { status, headers: h });
}
const notFound = () => respond(404, {});

export async function handleOidcStart(req: Request, ctx: OidcRouteCtx, spec: OidcSpec): Promise<Response> {
  if (!(await ctx.enabled())) return notFound();
  if (!ctx.config) return respond(503, {});
  const env = ctx.deps.env ?? process.env;
  // Per-client cap before any outbound work.
  const ip = clientIp(req.headers, { hops: trustProxyHops(env), env });
  const ipHash = await hmac(ctx.deps.keys, "auth/ip", ip);
  const gate = await guardedLimit(() =>
    ctx.deps.db((c) => checkRateLimit(c, `${spec.limitKey}:${ipHash}`, { limit: scaledLimit(ip, spec.limit), windowSeconds: 600, now: ctx.deps.now() })),
  );
  if (!gate.allowed) return respond(gate.busy ? 503 : 429, { "retry-after": String(gate.retryAfter) });
  try {
    const endpoints = await discover(ctx.config, ctx.fetch, ctx.deps.now().getTime(), spec.altIssuers?.(ctx.config));
    const state = randomBytes(24).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const usePkce = spec.pkce === "always" || endpoints.pkceS256;
    const verifier = usePkce ? randomBytes(48).toString("base64url") : null;
    const now = ctx.deps.now();
    // `p` binds the cookie to one provider, so a state minted for Google cannot complete a LinkedIn callback.
    const stateCookie = await signPayload(ctx.deps.keys, STATE_PURPOSE, { p: spec.provider, state, nonce, verifier, exp: now.getTime() + OIDC_STATE_TTL_MS });
    const url = new URL(endpoints.authorization);
    const params: Record<string, string> = {
      response_type: "code",
      client_id: ctx.config.clientId,
      redirect_uri: ctx.config.redirectUri,
      scope: spec.scope,
      state,
      nonce,
      ...spec.extraAuthParams,
    };
    if (verifier) {
      params["code_challenge"] = createHash("sha256").update(verifier).digest("base64url");
      params["code_challenge_method"] = "S256";
    }
    url.search = new URLSearchParams(params).toString();
    return respond(302, { location: url.toString() }, [oidcCookie(stateCookie, OIDC_STATE_TTL_MS / 1000, env)]);
  } catch {
    return respond(503, {});
  }
}

export async function handleOidcCallback(req: Request, ctx: OidcRouteCtx, spec: OidcSpec, issuersFor: (config: OidcConfig) => string[]): Promise<Response> {
  if (!(await ctx.enabled())) return notFound();
  const env = ctx.deps.env ?? process.env;
  const origin = appOrigin(env, req.url);
  const back = (path: string, cookies: CookieSpec[] = []) => respond(302, { location: `${origin}${path}` }, [clearOidcCookie(env), ...cookies]);
  const failed = () => back(`/signin?error=${spec.errorCode}`);

  if (!ctx.config) return failed();
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (params.get("error") || !code || !state || code.length > 2048 || state.length > 512) return failed();

  const cookieHeader = req.headers.get("cookie");
  const saved = (await verifyPayload(ctx.deps.keys, STATE_PURPOSE, readCookie(cookieHeader, cookieName(OIDC_COOKIE, env)))) as
    | { p?: unknown; state?: unknown; nonce?: unknown; verifier?: unknown; exp?: unknown }
    | null;
  if (!saved || saved.p !== spec.provider || typeof saved.state !== "string" || typeof saved.nonce !== "string" || typeof saved.exp !== "number") return failed();
  const verifier = typeof saved.verifier === "string" ? saved.verifier : null;
  if (spec.pkce === "always" && !verifier) return failed();
  if (ctx.deps.now().getTime() >= saved.exp || !safeEqual(saved.state, state)) return failed();

  try {
    const alt = spec.altIssuers?.(ctx.config) ?? [];
    const endpoints = await discover(ctx.config, ctx.fetch, Date.now(), alt);
    const form: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      redirect_uri: ctx.config.redirectUri,
      client_id: ctx.config.clientId,
      client_secret: ctx.config.clientSecret,
    };
    if (verifier) form["code_verifier"] = verifier;
    const tokenRes = await getJson(ctx.fetch, endpoints.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
    const idToken = (tokenRes.body as { id_token?: unknown } | null)?.id_token;
    if (tokenRes.status !== 200 || typeof idToken !== "string") return failed();
    const id = await verifyOidcIdToken(idToken, { config: ctx.config, fetch: ctx.fetch, nonce: saved.nonce, now: ctx.deps.now(), jwksUri: endpoints.jwks, issuers: issuersFor(ctx.config) });
    if (!id.ok) return failed();

    const userId = await ctx.deps.db((c) => resolveIdentity(c, { provider: spec.provider, subject: id.sub, email: id.email, emailVerified: true }));
    if (userId) {
      const previous = readCookie(cookieHeader, sessionCookieName(env));
      const session = await startSession(ctx.deps, { userId, previousToken: previous, ua: req.headers.get("user-agent") });
      return back("/you", [sessionCookie(session.token, SESSION_MAX_AGE_SECONDS, env)]);
    }
    const pending = await createPendingSignup(ctx.deps.keys, { provider: spec.provider, subject: id.sub, email: id.email }, ctx.deps.now());
    return back("/welcome", [pendingCookie(pending, PENDING_TTL_MS / 1000, env)]);
  } catch {
    return failed();
  }
}
