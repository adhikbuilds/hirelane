import { createHash, createPublicKey, createVerify, randomBytes, timingSafeEqual, type JsonWebKey } from "node:crypto";
import { clearOidcCookie, cookieName, oidcCookie, OIDC_COOKIE, pendingCookie, readCookie, serializeCookie, sessionCookie, sessionCookieName, type CookieSpec } from "./cookies";
import { hmac } from "@hirelane/vault";
import { checkRateLimit, clientIp, guardedLimit, scaledLimit, trustProxyHops } from "../rate-limit";
import { appOrigin } from "./origin";
import { createPendingSignup, PENDING_TTL_MS } from "./pending-signup";
import { resolveIdentity, SESSION_MAX_AGE_SECONDS, signPayload, startSession, verifyPayload, type AuthDeps } from "./session";

/**
 * Google OpenID Connect, authorization code flow with PKCE (S256), state and nonce, built on node:crypto.
 * No OIDC library: RS256 verification is a few lines and the audit surface stays small.
 * Tests use a local mock issuer behind an injected fetch; nothing here ever calls live Google from a test.
 */
export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const GOOGLE_ISSUER = "https://accounts.google.com";
const OIDC_STATE_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_S = 60;
const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = 5000;

/** From env, or null when Google sign-in is not configured. The redirect URI is always on this app's own origin. */
export function loadOidcConfig(env: Record<string, string | undefined> = process.env): OidcConfig | null {
  const clientId = env["HIRELANE_GOOGLE_CLIENT_ID"]?.trim();
  const clientSecret = env["HIRELANE_GOOGLE_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) return null;
  const prod = env["NODE_ENV"] === "production";
  const configured = env["HIRELANE_APP_ORIGIN"]?.trim().replace(/\/$/, "");
  // Production fails closed: an explicit https origin is required, and the issuer must be a public https URL.
  if (prod && (!configured || !isPublicHttps(configured))) return null;
  const issuer = env["HIRELANE_OIDC_ISSUER"]?.trim() || GOOGLE_ISSUER;
  if (prod && !isPublicHttps(issuer)) return null;
  const origin = configured || "http://localhost:3001";
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: `${origin}/auth/google/callback`,
  };
}

function isPublicHttps(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && url.hostname !== "[::1]";
  } catch {
    return false;
  }
}

interface Endpoints {
  authorization: string;
  token: string;
  jwks: string;
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

async function getJson(f: typeof fetch, url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
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

/** Discovery is cached for an hour per issuer, so /auth/google/start does not fan out one outbound fetch per hit. */
export async function discover(config: OidcConfig, f: typeof fetch, nowMs: number = Date.now()): Promise<Endpoints> {
  let byIssuer = discoveryCache.get(f);
  if (!byIssuer) discoveryCache.set(f, (byIssuer = new Map()));
  const hit = byIssuer.get(config.issuer);
  if (hit && nowMs - hit.at >= 0 && nowMs - hit.at < DISCOVERY_TTL_MS) return hit.endpoints;
  const endpoints = await discoverUncached(config, f);
  byIssuer.set(config.issuer, { at: nowMs, endpoints });
  return endpoints;
}

async function discoverUncached(config: OidcConfig, f: typeof fetch): Promise<Endpoints> {
  const { status, body } = await getJson(f, `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  const doc = body as Record<string, unknown> | null;
  if (status !== 200 || !doc || doc["issuer"] !== config.issuer) throw new Error("oidc: bad discovery document");
  const authorization = safeUrl(doc["authorization_endpoint"]);
  const token = safeUrl(doc["token_endpoint"]);
  const jwks = safeUrl(doc["jwks_uri"]);
  if (!authorization || !token || !jwks) throw new Error("oidc: discovery endpoints missing");
  return { authorization, token, jwks };
}

// ---------- ID token ----------

export type IdTokenResult = { ok: true; sub: string; email: string } | { ok: false };

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

/** Signature (RS256 only), issuer, audience, expiry, issued-at, nonce and verified email. Anything off returns {ok:false}. */
export async function verifyIdToken(
  idToken: string,
  opts: { config: OidcConfig; fetch: typeof fetch; nonce: string; now: Date; jwksUri?: string },
): Promise<IdTokenResult> {
  try {
    const jwt = parseJwt(idToken);
    if (!jwt) return fail;
    if (jwt.header["alg"] !== "RS256") return fail; // never "none", never HS*: the key is not a shared secret
    const kid = jwt.header["kid"];
    if (typeof kid !== "string") return fail;

    const jwksUri = opts.jwksUri ?? (await discover(opts.config, opts.fetch)).jwks;
    const { status, body } = await getJson(opts.fetch, jwksUri);
    const keys = (body as { keys?: (JsonWebKey & { kid?: string })[] } | null)?.keys;
    if (status !== 200 || !Array.isArray(keys)) return fail;
    const jwk = keys.find((k) => k.kid === kid && k.kty === "RSA");
    if (!jwk) return fail;
    const verifier = createVerify("RSA-SHA256").update(jwt.signingInput);
    if (!verifier.verify(createPublicKey({ key: jwk, format: "jwk" }), jwt.signature)) return fail;

    const c = jwt.claims;
    const t = Math.floor(opts.now.getTime() / 1000);
    const issuers = opts.config.issuer === GOOGLE_ISSUER ? [GOOGLE_ISSUER, "accounts.google.com"] : [opts.config.issuer];
    if (typeof c["iss"] !== "string" || !issuers.includes(c["iss"])) return fail;
    const aud = c["aud"];
    const audOk = typeof aud === "string" ? aud === opts.config.clientId : Array.isArray(aud) && aud.includes(opts.config.clientId) && c["azp"] === opts.config.clientId;
    if (!audOk) return fail;
    if (typeof c["exp"] !== "number" || c["exp"] + CLOCK_SKEW_S <= t) return fail;
    if (typeof c["iat"] !== "number" || c["iat"] - CLOCK_SKEW_S > t) return fail;
    if (typeof c["nonce"] !== "string" || !safeEqual(c["nonce"], opts.nonce)) return fail;
    if (typeof c["sub"] !== "string" || !c["sub"] || c["sub"].length > 255) return fail;
    if (typeof c["email"] !== "string" || !c["email"] || c["email"].length > 254) return fail;
    if (c["email_verified"] !== true && c["email_verified"] !== "true") return fail;
    return { ok: true, sub: c["sub"], email: c["email"].trim().toLowerCase() };
  } catch {
    return fail;
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- route logic ----------

export interface GoogleRouteCtx {
  deps: AuthDeps;
  config: OidcConfig | null;
  fetch: typeof fetch;
  enabled: () => Promise<boolean>;
}

export const GOOGLE_START_LIMIT = 20;
const STATE_PURPOSE = "auth/oidc-state";
const noStore = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

function respond(status: number, headers: Record<string, string>, cookies: CookieSpec[] = []): Response {
  const h = new Headers({ ...noStore, ...headers });
  for (const c of cookies) h.append("set-cookie", serializeCookie(c));
  return new Response(null, { status, headers: h });
}
const notFound = () => respond(404, {});

export async function handleGoogleStart(req: Request, ctx: GoogleRouteCtx): Promise<Response> {
  if (!(await ctx.enabled())) return notFound();
  if (!ctx.config) return respond(503, {});
  const env = ctx.deps.env ?? process.env;
  // Per-client cap before any outbound work: 20 starts per 10 minutes.
  const ip = clientIp(req.headers, { hops: trustProxyHops(env), env });
  const ipHash = await hmac(ctx.deps.keys, "auth/ip", ip);
  const gate = await guardedLimit(() =>
    ctx.deps.db((c) => checkRateLimit(c, `oidc-start-ip:${ipHash}`, { limit: scaledLimit(ip, GOOGLE_START_LIMIT), windowSeconds: 600, now: ctx.deps.now() })),
  );
  if (!gate.allowed) return respond(gate.busy ? 503 : 429, { "retry-after": String(gate.retryAfter) });
  try {
    const endpoints = await discover(ctx.config, ctx.fetch, ctx.deps.now().getTime());
    const state = randomBytes(24).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const now = ctx.deps.now();
    const stateCookie = await signPayload(ctx.deps.keys, STATE_PURPOSE, { state, nonce, verifier, exp: now.getTime() + OIDC_STATE_TTL_MS });
    const url = new URL(endpoints.authorization);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: ctx.config.clientId,
      redirect_uri: ctx.config.redirectUri,
      scope: "openid email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();
    return respond(302, { location: url.toString() }, [oidcCookie(stateCookie, OIDC_STATE_TTL_MS / 1000, env)]);
  } catch {
    return respond(503, {});
  }
}

export async function handleGoogleCallback(req: Request, ctx: GoogleRouteCtx): Promise<Response> {
  if (!(await ctx.enabled())) return notFound();
  const env = ctx.deps.env ?? process.env;
  const origin = appOrigin(env, req.url);
  const back = (path: string, cookies: CookieSpec[] = []) => respond(302, { location: `${origin}${path}` }, [clearOidcCookie(env), ...cookies]);
  const failed = () => back("/signin?error=google");

  if (!ctx.config) return failed();
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (params.get("error") || !code || !state || code.length > 2048 || state.length > 512) return failed();

  const cookieHeader = req.headers.get("cookie");
  const saved = (await verifyPayload(ctx.deps.keys, STATE_PURPOSE, readCookie(cookieHeader, cookieName(OIDC_COOKIE, env)))) as
    | { state?: unknown; nonce?: unknown; verifier?: unknown; exp?: unknown }
    | null;
  if (!saved || typeof saved.state !== "string" || typeof saved.nonce !== "string" || typeof saved.verifier !== "string" || typeof saved.exp !== "number") return failed();
  if (ctx.deps.now().getTime() >= saved.exp || !safeEqual(saved.state, state)) return failed();

  try {
    const endpoints = await discover(ctx.config, ctx.fetch);
    const tokenRes = await getJson(ctx.fetch, endpoints.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: ctx.config.redirectUri,
        client_id: ctx.config.clientId,
        client_secret: ctx.config.clientSecret,
        code_verifier: saved.verifier,
      }).toString(),
    });
    const idToken = (tokenRes.body as { id_token?: unknown } | null)?.id_token;
    if (tokenRes.status !== 200 || typeof idToken !== "string") return failed();
    const id = await verifyIdToken(idToken, { config: ctx.config, fetch: ctx.fetch, nonce: saved.nonce, now: ctx.deps.now(), jwksUri: endpoints.jwks });
    if (!id.ok) return failed();

    const userId = await ctx.deps.db((c) => resolveIdentity(c, { provider: "google", subject: id.sub, email: id.email, emailVerified: true }));
    if (userId) {
      const previous = readCookie(cookieHeader, sessionCookieName(env));
      const session = await startSession(ctx.deps, { userId, previousToken: previous, ua: req.headers.get("user-agent") });
      return back("/you", [sessionCookie(session.token, SESSION_MAX_AGE_SECONDS, env)]);
    }
    const pending = await createPendingSignup(ctx.deps.keys, { provider: "google", subject: id.sub, email: id.email }, ctx.deps.now());
    return back("/welcome", [pendingCookie(pending, PENDING_TTL_MS / 1000, env)]);
  } catch {
    return failed();
  }
}
