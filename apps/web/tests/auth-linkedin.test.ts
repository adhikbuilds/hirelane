import { EnvKeyProvider, generateMasterKey } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requestEmailCode, verifyEmailCode, type EmailCodeDeps } from "../lib/auth/email-code";
import { handleLinkedInCallback, handleLinkedInStart, linkedinEnabled, loadLinkedInConfig, verifyLinkedInIdToken, type LinkedInRouteCtx } from "../lib/auth/linkedin";
import { completeSignup } from "../lib/auth/pending-signup";
import { sessionFromToken } from "../lib/auth/session";
import { authTestDb } from "./helpers/auth-db";
import { createMockIssuer } from "./helpers/mock-oidc";

let client: Client;
let close: () => Promise<void>;
const keys = new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() });
const ENV = { NODE_ENV: "test" } as Record<string, string | undefined>;
let clock = new Date("2032-01-01T10:00:00Z");
let sent: { to: string; code: string }[] = [];
let n = 0;
const email = () => `li-fixture-${++n}-${Math.random().toString(36).slice(2, 8)}@example.test`;
const deps = (): EmailCodeDeps => ({ db: (fn) => fn(client), keys, now: () => clock, env: ENV, sendCode: async (to, code) => void sent.push({ to, code }) });
const count = async (sql: string, p: unknown[] = []) => (await client.query(sql, p)).rows[0].n as number;
const attest = { over18: true, terms: true, privacy: true };
const REDIRECT = "http://localhost:3001/auth/linkedin/callback";

beforeAll(async () => {
  ({ client, close } = await authTestDb("hirelane_auth_linkedin_test"));
});
afterAll(async () => {
  await close();
});

const cookieHeader = (res: Response, name: string) => {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line ? { line, value: line.split(";")[0]!.slice(name.length + 1) } : null;
};

function setup(pkce = true) {
  const mock = createMockIssuer("https://issuer.example.test", () => clock, { redirectUri: REDIRECT, pkce });
  const ctx = (over: Partial<LinkedInRouteCtx> = {}): LinkedInRouteCtx => ({
    deps: { ...deps(), env: { NODE_ENV: "test", TRUST_X_REAL_IP: "1" } },
    config: { issuer: mock.issuer, clientId: mock.clientId, clientSecret: mock.clientSecret, redirectUri: mock.redirectUri },
    fetch: mock.fetch,
    enabled: async () => true,
    ...over,
  });
  const begin = async (over: Partial<LinkedInRouteCtx> = {}, ip = "198.51.100.7") => {
    const res = await handleLinkedInStart(new Request("http://localhost:3001/auth/linkedin/start", { headers: { "user-agent": "t", "x-real-ip": ip } }), ctx(over));
    return { res, loc: res.headers.get("location")! };
  };
  const callback = (params: Record<string, string>, oidc: string | null, over: Partial<LinkedInRouteCtx> = {}, extraCookie = "") => {
    const u = new URL("http://localhost:3001/auth/linkedin/callback");
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const c = [oidc ? `__Host-hl_oidc=${oidc}` : "", extraCookie].filter(Boolean).join("; ");
    return handleLinkedInCallback(new Request(u, { headers: c ? { cookie: c } : {} }), ctx(over));
  };
  const fails = (r: Response) => {
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.pathname).toBe("/signin");
    expect(loc.searchParams.get("error")).toBe("linkedin");
    expect(cookieHeader(r, "__Host-hl_session")).toBeNull();
    expect(cookieHeader(r, "__Host-hl_pending")).toBeNull();
  };
  return { mock, ctx, begin, callback, fails };
}

describe("linkedin config", () => {
  const base = { LINKEDIN_CLIENT_ID: "id", LINKEDIN_CLIENT_SECRET: "s" };
  it("is null without both secrets, so the button stays hidden", () => {
    expect(loadLinkedInConfig({})).toBeNull();
    expect(loadLinkedInConfig({ LINKEDIN_CLIENT_ID: "id" })).toBeNull();
    expect(loadLinkedInConfig({ LINKEDIN_CLIENT_ID: "  ", LINKEDIN_CLIENT_SECRET: "s" })).toBeNull();
    expect(linkedinEnabled({})).toBe(false);
    expect(linkedinEnabled(base)).toBe(true);
  });
  it("defaults to LinkedIn's issuer and this app's own callback", () => {
    const c = loadLinkedInConfig(base)!;
    expect(c.issuer).toBe("https://www.linkedin.com/oauth");
    expect(c.redirectUri).toBe("http://localhost:3001/auth/linkedin/callback");
    expect(loadLinkedInConfig({ ...base, HIRELANE_APP_ORIGIN: "https://app.example.test/" })!.redirectUri).toBe("https://app.example.test/auth/linkedin/callback");
  });
  it("fails closed in production without an https origin or with a local issuer", () => {
    expect(loadLinkedInConfig({ ...base, NODE_ENV: "production" })).toBeNull();
    expect(loadLinkedInConfig({ ...base, NODE_ENV: "production", HIRELANE_APP_ORIGIN: "http://app.example.test" })).toBeNull();
    expect(loadLinkedInConfig({ ...base, NODE_ENV: "production", HIRELANE_APP_ORIGIN: "https://app.example.test", HIRELANE_LINKEDIN_ISSUER: "http://localhost:9" })).toBeNull();
    expect(linkedinEnabled({ ...base, NODE_ENV: "production" })).toBe(false);
    expect(loadLinkedInConfig({ ...base, NODE_ENV: "production", HIRELANE_APP_ORIGIN: "https://app.example.test" })).not.toBeNull();
  });
});

describe("linkedin start", () => {
  it("redirects with scopes openid profile email, state, nonce and PKCE when discovery advertises S256", async () => {
    const { begin, mock } = setup(true);
    const { res, loc } = await begin();
    expect(res.status).toBe(302);
    const u = new URL(loc);
    expect(u.origin + u.pathname).toBe(`${mock.issuer}/authorize`);
    const p = u.searchParams;
    expect(p.get("scope")).toBe("openid profile email");
    expect(p.get("redirect_uri")).toBe(REDIRECT);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("state")!.length).toBeGreaterThanOrEqual(22);
    expect(p.get("nonce")!.length).toBeGreaterThanOrEqual(22);
    expect(p.get("prompt")).toBeNull();
    const ck = cookieHeader(res, "__Host-hl_oidc")!;
    expect(ck.line).toMatch(/HttpOnly/);
    expect(ck.line).toMatch(/SameSite=Lax/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("falls back to state + nonce, with no challenge and no verifier, when PKCE is not advertised; sign-in still completes", async () => {
    const { begin, callback, mock } = setup(false);
    const { res, loc } = await begin();
    const p = new URL(loc).searchParams;
    expect(p.has("code_challenge")).toBe(false);
    expect(p.has("code_challenge_method")).toBe(false);
    expect(p.get("state")).toBeTruthy();
    expect(p.get("nonce")).toBeTruthy();
    const e = email();
    const a = mock.authorize(loc, { sub: `li-nopkce-${e}`, email: e });
    const r = await callback(a, cookieHeader(res, "__Host-hl_oidc")!.value);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/welcome");
  });

  it("flag off: 404 and LinkedIn is never contacted", async () => {
    const { ctx, mock } = setup();
    const before = mock.requests.length;
    const off = ctx({ enabled: async () => false });
    const s = await handleLinkedInStart(new Request("http://localhost:3001/auth/linkedin/start"), off);
    const c = await handleLinkedInCallback(new Request("http://localhost:3001/auth/linkedin/callback?code=x&state=y"), off);
    expect([s.status, c.status]).toEqual([404, 404]);
    expect(mock.requests.length).toBe(before);
  });

  it("fails closed without config: start is 503, callback goes to /signin", async () => {
    const { begin, callback, fails, mock } = setup();
    const before = mock.requests.length;
    expect((await begin({ config: null })).res.status).toBe(503);
    fails(await callback({ code: "x", state: "y" }, "z", { config: null }));
    expect(mock.requests.length).toBe(before);
  });

  it("is rate limited per client, separately from Google", async () => {
    const { begin } = setup();
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push((await begin({}, "203.0.113.77")).res.status);
    expect(codes.slice(0, 5).every((c) => c === 302)).toBe(true);
    expect(codes).toContain(429);
  });
});

describe("linkedin callback", () => {
  it("a new person gets a pending cookie and /welcome, no account rows, then the 18+ gate creates a linkedin identity", async () => {
    const { begin, callback, mock } = setup();
    const e = email();
    const { res: s, loc } = await begin();
    const a = mock.authorize(loc, { sub: `li-${e}`, email: e }, { name: "Fixture Person" });
    const before = await count("SELECT count(*)::int AS n FROM users");
    const res = await callback(a, cookieHeader(s, "__Host-hl_oidc")!.value);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/welcome");
    expect(cookieHeader(res, "__Host-hl_pending")).not.toBeNull();
    expect(cookieHeader(res, "__Host-hl_session")).toBeNull();
    expect(cookieHeader(res, "__Host-hl_oidc")!.line).toMatch(/Max-Age=0/);
    expect(await count("SELECT count(*)::int AS n FROM users")).toBe(before);
    const done = await completeSignup(deps(), decodeURIComponent(cookieHeader(res, "__Host-hl_pending")!.value), attest, {});
    expect(done.ok).toBe(true);
    expect(await count("SELECT count(*)::int AS n FROM auth_identities WHERE provider = 'linkedin' AND subject = $1", [`li-${e}`])).toBe(1);
  });

  it("an existing identity signs in with a rotated session and goes to /you", async () => {
    const { begin, callback, mock } = setup();
    const e = email();
    const { res: s1, loc: l1 } = await begin();
    const r1 = await callback(mock.authorize(l1, { sub: `li2-${e}`, email: e }), cookieHeader(s1, "__Host-hl_oidc")!.value);
    const done = await completeSignup(deps(), decodeURIComponent(cookieHeader(r1, "__Host-hl_pending")!.value), attest, {});
    if (!done.ok) throw new Error("setup");
    const { res: s2, loc: l2 } = await begin();
    const r2 = await callback(mock.authorize(l2, { sub: `li2-${e}`, email: e }), cookieHeader(s2, "__Host-hl_oidc")!.value, {}, `__Host-hl_session=${done.session.token}`);
    expect(new URL(r2.headers.get("location")!).pathname).toBe("/you");
    const sess = cookieHeader(r2, "__Host-hl_session")!;
    expect(sess.line).toMatch(/HttpOnly/);
    expect(sess.value).not.toBe(done.session.token);
    expect(await sessionFromToken(deps(), done.session.token)).toBeNull();
    expect((await sessionFromToken(deps(), sess.value))?.userId).toBe(done.userId);
  });

  it("a verified email matching an email-code account links to it rather than creating a second user", async () => {
    const { begin, callback, mock } = setup();
    const e = email();
    await requestEmailCode(deps(), { email: e, ip: "10.7.0.1" });
    const v = await verifyEmailCode(deps(), { email: e, code: sent.filter((x) => x.to === e).at(-1)!.code, ip: "10.7.0.1" });
    if (v.kind !== "pending") throw new Error("setup");
    const first = await completeSignup(deps(), v.cookieValue, attest, {});
    if (!first.ok) throw new Error("setup");
    const { res: s, loc } = await begin();
    const r = await callback(mock.authorize(loc, { sub: `li3-${e}`, email: e }), cookieHeader(s, "__Host-hl_oidc")!.value);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/you");
    expect((await sessionFromToken(deps(), cookieHeader(r, "__Host-hl_session")!.value))?.userId).toBe(first.userId);
    expect(await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [e])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM auth_identities WHERE user_id = $1 AND provider = 'linkedin'", [first.userId])).toBe(1);
  });

  it("an unverified email never links to an existing account", async () => {
    const { begin, callback, fails, mock } = setup();
    const e = email();
    await requestEmailCode(deps(), { email: e, ip: "10.7.0.2" });
    const v = await verifyEmailCode(deps(), { email: e, code: sent.filter((x) => x.to === e).at(-1)!.code, ip: "10.7.0.2" });
    if (v.kind !== "pending") throw new Error("setup");
    await completeSignup(deps(), v.cookieValue, attest, {});
    const { res: s, loc } = await begin();
    fails(await callback(mock.authorize(loc, { sub: `li4-${e}`, email: e, emailVerified: false }), cookieHeader(s, "__Host-hl_oidc")!.value));
    expect(await count("SELECT count(*)::int AS n FROM auth_identities WHERE provider = 'linkedin' AND subject = $1", [`li4-${e}`])).toBe(0);
  });

  it("fails on a wrong state, a missing cookie, a replayed code, a provider error and a missing code", async () => {
    const { begin, callback, fails, mock } = setup();
    const e = email();
    const users0 = await count("SELECT count(*)::int AS n FROM users");
    const { res: s, loc } = await begin();
    const ck = cookieHeader(s, "__Host-hl_oidc")!.value;
    const a = mock.authorize(loc, { sub: `li5-${e}`, email: e });
    fails(await callback({ code: a.code, state: "forged" }, ck));
    fails(await callback({ code: a.code, state: a.state }, null));
    fails(await callback({ error: "user_cancelled_login", state: a.state }, ck));
    fails(await callback({ state: a.state }, ck));
    expect(new URL((await callback(a, ck)).headers.get("location")!).pathname).toBe("/welcome");
    fails(await callback(a, ck)); // the code was single use
    expect(await count("SELECT count(*)::int AS n FROM users")).toBe(users0);
  });

  it("rejects a wrong nonce, another client's token, a stale cookie and a cookie from another key", async () => {
    const { begin, callback, fails, mock } = setup();
    const e = email();
    const one = async (claims: Record<string, unknown>, over: Partial<LinkedInRouteCtx> = {}) => {
      const { res, loc } = await begin();
      return callback(mock.authorize(loc, { sub: `li6-${e}`, email: e }, claims), cookieHeader(res, "__Host-hl_oidc")!.value, over);
    };
    fails(await one({ nonce: "attacker-nonce" }));
    fails(await one({ aud: "another-client" }));
    fails(await one({}, { deps: { ...deps(), keys: new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() }) } }));
    fails(await one({}, { deps: { ...deps(), now: () => new Date(clock.getTime() + 11 * 60_000) } }));
    expect(await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [e])).toBe(0);
  });

  it("a state cookie minted by the Google start cannot complete a LinkedIn callback", async () => {
    const { callback, fails, mock } = setup();
    const { handleGoogleStart } = await import("../lib/auth/google");
    const e = email();
    const gres = await handleGoogleStart(new Request("http://localhost:3001/auth/google/start", { headers: { "x-real-ip": "198.51.100.50" } }), {
      deps: deps(),
      config: { issuer: mock.issuer, clientId: mock.clientId, clientSecret: mock.clientSecret, redirectUri: mock.redirectUri },
      fetch: mock.fetch,
      enabled: async () => true,
    });
    const a = mock.authorize(gres.headers.get("location")!, { sub: `li7-${e}`, email: e });
    fails(await callback(a, cookieHeader(gres, "__Host-hl_oidc")!.value));
  });

  it("only calls the OIDC endpoints: discovery, token and JWKS", async () => {
    const { begin, callback, mock } = setup();
    mock.requests.length = 0;
    const e = email();
    const { res, loc } = await begin();
    await callback(mock.authorize(loc, { sub: `li8-${e}`, email: e }), cookieHeader(res, "__Host-hl_oidc")!.value);
    const paths = new Set(mock.requests.map((r) => new URL(r.url).pathname));
    expect([...paths].every((p) => ["/.well-known/openid-configuration", "/token", "/jwks"].includes(p))).toBe(true);
  });

  it("prints nothing identifying", async () => {
    const out: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" "))));
    try {
      const { begin, callback, mock } = setup();
      const e = email();
      const { res, loc } = await begin();
      const a = mock.authorize(loc, { sub: `li9-${e}`, email: e }, { name: "Fixture Person" });
      const ck = cookieHeader(res, "__Host-hl_oidc")!.value;
      await callback(a, ck);
      await callback(a, ck);
      expect(out.join("\n")).not.toContain(e);
      expect(out.join("\n")).not.toContain("Fixture Person");
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe("verifyLinkedInIdToken", () => {
  const NOW = new Date("2032-01-01T10:00:00Z");
  const sec = Math.floor(NOW.getTime() / 1000);
  const mk = (issuer = "https://issuer.example.test", opts = {}) => {
    const m = createMockIssuer(issuer, () => NOW, opts);
    const config = { issuer: m.issuer, clientId: m.clientId, clientSecret: m.clientSecret, redirectUri: REDIRECT };
    const good = { iss: m.issuer, aud: m.clientId, sub: "li-sub", email: "Fixture@Example.Test", email_verified: true, nonce: "n1", iat: sec, exp: sec + 300, name: "  Fixture Person  " };
    const check = (t: string) => verifyLinkedInIdToken(t, { config, fetch: m.fetch, nonce: "n1", now: NOW });
    return { m, good, check };
  };

  it("returns email (lower-cased), sub and the trimmed name only", async () => {
    const { m, good, check } = mk();
    expect(await check(m.mint({ ...good, picture: "https://img.example.test/x", locale: "en_US", given_name: "F" }))).toEqual({ ok: true, sub: "li-sub", email: "fixture@example.test", name: "Fixture Person" });
  });

  it("drops control characters, caps the name length and tolerates a missing or non-string name", async () => {
    const { m, good, check } = mk();
    const r = (await check(m.mint({ ...good, name: `A\u0000B\n${"x".repeat(500)}` }))) as { ok: true; name: string };
    expect(r.name.startsWith("AB")).toBe(true);
    expect(r.name.length).toBe(200);
    expect(await check(m.mint({ ...good, name: undefined }))).toEqual({ ok: true, sub: "li-sub", email: "fixture@example.test" });
    expect(await check(m.mint({ ...good, name: 42 }))).toEqual({ ok: true, sub: "li-sub", email: "fixture@example.test" });
  });

  const bad: [string, (g: Record<string, unknown>) => Record<string, unknown>][] = [
    ["wrong issuer", (g) => ({ ...g, iss: "https://evil.example.test" })],
    ["wrong audience", (g) => ({ ...g, aud: "someone-else" })],
    ["expired", (g) => ({ ...g, exp: sec - 120 })],
    ["wrong nonce", (g) => ({ ...g, nonce: "other" })],
    ["unverified email", (g) => ({ ...g, email_verified: false })],
    ["email_verified missing", (g) => ({ ...g, email_verified: undefined })],
    ["missing email", (g) => ({ ...g, email: undefined })],
  ];
  for (const [name, mutate] of bad) {
    it(`rejects ${name}`, async () => {
      const { m, good, check } = mk();
      expect((await check(m.mint(mutate(good)))).ok).toBe(false);
    });
  }

  it("rejects alg none, HS256 and a foreign signing key", async () => {
    const { m, good, check } = mk();
    expect((await check(m.mint(good, { alg: "none" }))).ok).toBe(false);
    expect((await check(m.mint(good, { alg: "HS256" }))).ok).toBe(false);
    expect((await check(m.mint(good, { key: m.otherKey }))).ok).toBe(false);
  });

  it("accepts LinkedIn's bare-origin iss next to its /oauth discovery issuer, but only for LinkedIn's own issuer", async () => {
    const real = mk("https://www.linkedin.com/oauth", { discoveryIssuer: "https://www.linkedin.com" });
    expect((await real.check(real.m.mint({ ...real.good, iss: "https://www.linkedin.com" }))).ok).toBe(true);
    expect((await real.check(real.m.mint(real.good))).ok).toBe(true);
    const other = mk();
    expect((await other.check(other.m.mint({ ...other.good, iss: "https://www.linkedin.com" }))).ok).toBe(false);
  });
});
