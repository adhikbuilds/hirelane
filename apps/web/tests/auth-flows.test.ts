import { EnvKeyProvider, generateMasterKey } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readCookie } from "../lib/auth/cookies";
import { requestEmailCode, verifyEmailCode, type EmailCodeDeps } from "../lib/auth/email-code";
import { handleGoogleCallback, handleGoogleStart, type GoogleRouteCtx } from "../lib/auth/google";
import { completeSignup, createPendingSignup } from "../lib/auth/pending-signup";
import { deleteAccountFor, endSession, sessionFromToken, startSession } from "../lib/auth/session";
import { authTestDb } from "./helpers/auth-db";
import { createMockIssuer } from "./helpers/mock-oidc";

let client: Client;
let close: () => Promise<void>;
let connect: () => Promise<Client>;
const keys = new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() });
const ENV = { NODE_ENV: "test" } as Record<string, string | undefined>;
let clock = new Date("2030-01-01T10:00:00Z");
let sent: { to: string; code: string; purpose: string }[] = [];
let n = 0;
const email = () => `scan-fixture-${++n}-${Math.random().toString(36).slice(2, 8)}@example.test`;

const deps = (): EmailCodeDeps => ({
  db: (fn) => fn(client),
  keys,
  now: () => clock,
  env: ENV,
  sendCode: async (to, code, purpose) => void sent.push({ to, code, purpose }),
});
const tick = (ms: number) => (clock = new Date(clock.getTime() + ms));
const lastCode = (to: string) => sent.filter((s) => s.to === to).at(-1)!.code;
const count = async (sql: string, p: unknown[] = []) => (await client.query(sql, p)).rows[0].n as number;
const attest = { over18: true, terms: true, privacy: true };

beforeAll(async () => {
  ({ client, close, connect } = await authTestDb("hirelane_auth_flows_test"));
});
afterAll(async () => {
  await close();
});
beforeEach(() => {
  sent = [];
  clock = new Date(clock.getTime() + 3 * 3600_000); // fresh rate-limit windows per test
});

async function signUpViaCode(to: string) {
  await requestEmailCode(deps(), { email: to, ip: "10.0.0.1" });
  const v = await verifyEmailCode(deps(), { email: to, code: lastCode(to), ip: "10.0.0.1" });
  if (v.kind !== "pending") throw new Error(`expected pending, got ${v.kind}`);
  const done = await completeSignup(deps(), v.cookieValue, attest, {});
  if (!done.ok) throw new Error("signup failed");
  tick(61_000); // clear the resend cooldown for the next code request
  return done;
}

describe("email code: request", () => {
  it("answers byte-identically for a known and an unknown address, and sends a code for both", async () => {
    const known = email();
    await signUpViaCode(known);
    sent = [];
    const a = await requestEmailCode(deps(), { email: known, ip: "10.0.0.2" });
    const b = await requestEmailCode(deps(), { email: email(), ip: "10.0.0.2" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(sent).toHaveLength(2);
    expect(sent.every((s) => /^\d{6}$/.test(s.code))).toBe(true);
  });

  it("is case and whitespace insensitive on the address", async () => {
    const e = email();
    await requestEmailCode(deps(), { email: `  ${e.toUpperCase()} `, ip: "10.0.0.3" });
    expect(sent[0]?.to).toBe(e);
  });

  it("stores neither the address nor the code in the database", async () => {
    const e = email();
    await requestEmailCode(deps(), { email: e, ip: "10.0.0.4" });
    const rows = JSON.stringify((await client.query("SELECT * FROM otp_challenges")).rows) + JSON.stringify((await client.query("SELECT * FROM rate_limits")).rows);
    expect(rows).not.toContain(e);
    expect(rows).not.toContain(lastCode(e));
    expect(rows).not.toContain("10.0.0.4");
  });

  it("rejects things that are not email addresses, without sending", async () => {
    for (const bad of ["", "nope", "a@b", "a b@example.test", "x".repeat(300) + "@example.test"]) {
      const r = await requestEmailCode(deps(), { email: bad, ip: "10.0.0.5" });
      expect(r).toMatchObject({ ok: false, reason: "invalid_email" });
    }
    expect(sent).toHaveLength(0);
  });

  it("limits each IP, but not other IPs", async () => {
    const results = [];
    for (let i = 0; i < 12; i++) results.push(await requestEmailCode(deps(), { email: email(), ip: "10.1.0.1" }));
    expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(results[10]).toMatchObject({ ok: false, reason: "rate_limited" });
    expect((results[10] as { retryAfter: number }).retryAfter).toBeGreaterThan(0);
    expect(await requestEmailCode(deps(), { email: email(), ip: "10.1.0.2" })).toEqual({ ok: true });
  });

  it("limits each target silently: same response, no extra mail", async () => {
    const e = email();
    const out = [];
    for (let i = 0; i < 8; i++) {
      out.push(await requestEmailCode(deps(), { email: e, ip: `10.2.0.${i + 1}` }));
      tick(61_000); // past the resend cooldown, inside the 10 minute window
    }
    expect(new Set(out.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(sent.filter((s) => s.to === e).length).toBe(5);
  });

  it("still answers the same when mail delivery fails", async () => {
    const d = { ...deps(), sendCode: async () => Promise.reject(new Error("smtp down")) };
    const a = await requestEmailCode(d, { email: email(), ip: "10.3.0.1" });
    expect(a).toEqual({ ok: true });
  });
});

describe("email code: verify", () => {
  it("refuses the 6th attempt even with the right code", async () => {
    const e = email();
    await requestEmailCode(deps(), { email: e, ip: "10.4.0.1" });
    const right = lastCode(e);
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await verifyEmailCode(deps(), { email: e, code: wrong, ip: "10.4.0.2" })).kind).toBe("invalid");
    expect((await verifyEmailCode(deps(), { email: e, code: right, ip: "10.4.0.2" })).kind).toBe("invalid");
  });

  it("refuses an expired code", async () => {
    const e = email();
    await requestEmailCode(deps(), { email: e, ip: "10.4.1.1" });
    tick(10 * 60_000 + 1000);
    expect((await verifyEmailCode(deps(), { email: e, code: lastCode(e), ip: "10.4.1.2" })).kind).toBe("invalid");
  });

  it("gives wrong, expired, unknown and malformed codes the same answer", async () => {
    const e = email();
    await requestEmailCode(deps(), { email: e, ip: "10.4.2.1" });
    const wrong = await verifyEmailCode(deps(), { email: e, code: "000000", ip: "10.4.2.2" });
    const unknown = await verifyEmailCode(deps(), { email: email(), code: "000000", ip: "10.4.2.2" });
    const malformed = await verifyEmailCode(deps(), { email: e, code: "abc", ip: "10.4.2.2" });
    expect(JSON.stringify(wrong)).toBe(JSON.stringify(unknown));
    expect(JSON.stringify(wrong)).toBe(JSON.stringify(malformed));
  });

  it("a code works once", async () => {
    const e = email();
    await requestEmailCode(deps(), { email: e, ip: "10.4.3.1" });
    const code = lastCode(e);
    expect((await verifyEmailCode(deps(), { email: e, code, ip: "10.4.3.2" })).kind).toBe("pending");
    expect((await verifyEmailCode(deps(), { email: e, code, ip: "10.4.3.2" })).kind).toBe("invalid");
  });

  it("limits verification attempts per IP", async () => {
    let last = "";
    for (let i = 0; i < 40; i++) last = (await verifyEmailCode(deps(), { email: email(), code: "000000", ip: "10.4.4.1" })).kind;
    expect(last).toBe("rate_limited");
  });

  it("a new address ends in a pending signup and writes no account rows", async () => {
    const e = email();
    const before = [await count("SELECT count(*)::int AS n FROM users"), await count("SELECT count(*)::int AS n FROM auth_identities")];
    await requestEmailCode(deps(), { email: e, ip: "10.4.5.1" });
    const v = await verifyEmailCode(deps(), { email: e, code: lastCode(e), ip: "10.4.5.2" });
    expect(v.kind).toBe("pending");
    expect([await count("SELECT count(*)::int AS n FROM users"), await count("SELECT count(*)::int AS n FROM auth_identities")]).toEqual(before);
  });

  it("an existing account signs in and the presented session is rotated away", async () => {
    const e = email();
    const first = await signUpViaCode(e);
    await requestEmailCode(deps(), { email: e, ip: "10.4.6.1" });
    const v = await verifyEmailCode(deps(), { email: e, code: lastCode(e), ip: "10.4.6.2", previousToken: first.session.token });
    expect(v.kind).toBe("signed_in");
    if (v.kind !== "signed_in") return;
    expect(v.userId).toBe(first.userId);
    expect(v.session.token).not.toBe(first.session.token);
    expect(await sessionFromToken(deps(), first.session.token)).toBeNull();
    expect((await sessionFromToken(deps(), v.session.token))?.userId).toBe(first.userId);
  });
});

describe("18+ gate", () => {
  const pendingFor = (to: string) => createPendingSignup(keys, { provider: "email_otp", subject: `subj-${to}`, email: to }, clock);

  it("under 18 stores nothing and no account exists", async () => {
    const e = email();
    const r = await completeSignup(deps(), await pendingFor(e), { over18: false, terms: true, privacy: true }, {});
    expect(r).toEqual({ ok: false, reason: "under_18" });
    expect(await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [e])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM auth_identities WHERE subject = $1", [`subj-${e}`])).toBe(0);
  });

  it("terms and privacy are both required", async () => {
    const e = email();
    for (const a of [{ over18: true, terms: false, privacy: true }, { over18: true, terms: true, privacy: false }]) {
      expect(await completeSignup(deps(), await pendingFor(e), a, {})).toEqual({ ok: false, reason: "consent_required" });
    }
    expect(await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [e])).toBe(0);
  });

  it("refuses a missing, tampered or expired pending cookie", async () => {
    const e = email();
    expect(await completeSignup(deps(), undefined, attest, {})).toEqual({ ok: false, reason: "expired" });
    expect(await completeSignup(deps(), "garbage.value", attest, {})).toEqual({ ok: false, reason: "expired" });
    const v = await pendingFor(e);
    tick(16 * 60_000);
    expect(await completeSignup(deps(), v, attest, {})).toEqual({ ok: false, reason: "expired" });
    expect(await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [e])).toBe(0);
  });

  it("writes the user, the identity and the three consents together, and starts a session", async () => {
    const e = email();
    const r = await completeSignup(deps(), await pendingFor(e), attest, { ua: "test-agent" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const kinds = (await client.query("SELECT kind, granted, doc_version FROM consents WHERE user_id = $1 ORDER BY kind", [r.userId])).rows;
    expect(kinds.map((k) => k.kind)).toEqual(["age_18_plus", "privacy", "terms"]);
    expect(kinds.every((k) => k.granted === true && k.doc_version.length > 0)).toBe(true);
    expect(await count("SELECT count(*)::int AS n FROM auth_identities WHERE user_id = $1", [r.userId])).toBe(1);
    expect((await client.query("SELECT email_verified_at FROM users WHERE id = $1", [r.userId])).rows[0].email_verified_at).not.toBeNull();
    expect((await sessionFromToken(deps(), r.session.token))?.userId).toBe(r.userId);
  });

  it("two simultaneous accepts make one account", async () => {
    const e = email();
    const v = await pendingFor(e);
    // Two requests are two pooled connections in production; a shared Client would interleave their transactions.
    const own = async <T,>(fn: (c: Client) => Promise<T>): Promise<T> => {
      const c = await connect();
      try {
        return await fn(c);
      } finally {
        await c.end();
      }
    };
    const [a, b] = await Promise.all([completeSignup({ ...deps(), db: own }, v, attest, {}), completeSignup({ ...deps(), db: own }, v, attest, {})]);
    // The pending token is single-use: one accept wins, the other finds the account and expires.
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [e])).toBe(1);
  });

  it("0 users rows without an age_18_plus consent, across everything the suite created", async () => {
    const n0 = await count(
      `SELECT count(*)::int AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM consents k WHERE k.user_id = u.id AND k.kind = 'age_18_plus' AND k.granted)`,
    );
    expect(n0).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM users")).toBeGreaterThan(0);
  });
});

describe("logout and delete", () => {
  it("logout revokes the session server-side", async () => {
    const { session, userId } = await signUpViaCode(email());
    expect((await sessionFromToken(deps(), session.token))?.userId).toBe(userId);
    expect(await endSession(deps(), session.token)).toBe(true);
    expect(await sessionFromToken(deps(), session.token)).toBeNull();
    const row = await client.query("SELECT revoked_at FROM sessions WHERE user_id = $1", [userId]);
    expect(row.rows[0].revoked_at).not.toBeNull();
  });

  it("delete revokes every session, removes the account, and the address can start fresh", async () => {
    const e = email();
    const { session, userId } = await signUpViaCode(e);
    const second = await startSession(deps(), { userId, client: "web" });
    expect((await deleteAccountFor(deps(), userId)).deleted).toBe(true);
    expect(await sessionFromToken(deps(), session.token)).toBeNull();
    expect(await sessionFromToken(deps(), second.token)).toBeNull();
    for (const [t, c] of [["users", "id"], ["consents", "user_id"], ["auth_identities", "user_id"], ["sessions", "user_id"]] as const) {
      expect(await count(`SELECT count(*)::int AS n FROM ${t} WHERE ${c} = $1`, [userId]), t).toBe(0);
    }
    await requestEmailCode(deps(), { email: e, ip: "10.5.0.1" });
    expect((await verifyEmailCode(deps(), { email: e, code: lastCode(e), ip: "10.5.0.2" })).kind).toBe("pending");
  });
});

describe("google sign-in routes", () => {
  const mock = createMockIssuer("https://issuer.example.test", () => clock);
  const ctx = (over: Partial<GoogleRouteCtx> = {}): GoogleRouteCtx => ({
    deps: deps(),
    config: { issuer: mock.issuer, clientId: mock.clientId, clientSecret: mock.clientSecret, redirectUri: mock.redirectUri },
    fetch: mock.fetch,
    enabled: async () => true,
    ...over,
  });
  const cookieHeader = (res: Response, name: string) => {
    const all = res.headers.getSetCookie();
    const line = all.find((c) => c.startsWith(`${name}=`));
    return line ? { line, value: line.split(";")[0]!.slice(name.length + 1) } : null;
  };
  const begin = async (over: Partial<GoogleRouteCtx> = {}) => {
    const res = await handleGoogleStart(new Request("http://localhost:3001/auth/google/start"), ctx(over));
    return { res, loc: res.headers.get("location")! };
  };
  const callback = (params: Record<string, string>, oidcCookie: string | null, over: Partial<GoogleRouteCtx> = {}, extraCookie = "") => {
    const u = new URL("http://localhost:3001/auth/google/callback");
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const headers: Record<string, string> = {};
    const c = [oidcCookie ? `__Host-hl_oidc=${oidcCookie}` : "", extraCookie].filter(Boolean).join("; ");
    if (c) headers["cookie"] = c;
    return handleGoogleCallback(new Request(u, { headers }), ctx(over));
  };

  it("flag off: both routes are 404 and Google is never contacted", async () => {
    const before = mock.requests.length;
    const off = { enabled: async () => false };
    const s = await handleGoogleStart(new Request("http://localhost:3001/auth/google/start"), ctx(off));
    const c = await handleGoogleCallback(new Request("http://localhost:3001/auth/google/callback?code=x&state=y"), ctx(off));
    expect([s.status, c.status]).toEqual([404, 404]);
    expect(mock.requests.length).toBe(before);
  });

  it("start redirects with PKCE S256, state, nonce and a short-lived HttpOnly Lax cookie", async () => {
    const { res, loc } = await begin();
    expect(res.status).toBe(302);
    const u = new URL(loc);
    expect(u.origin + u.pathname).toBe(`${mock.issuer}/authorize`);
    const p = u.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe(mock.clientId);
    expect(p.get("redirect_uri")).toBe(mock.redirectUri);
    expect(p.get("scope")).toBe("openid email");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("state")!.length).toBeGreaterThanOrEqual(22);
    expect(p.get("nonce")!.length).toBeGreaterThanOrEqual(22);
    expect(p.get("code_verifier")).toBeNull();
    const ck = cookieHeader(res, "__Host-hl_oidc")!;
    expect(ck.line).toMatch(/HttpOnly/);
    expect(ck.line).toMatch(/SameSite=Lax/);
    expect(ck.line).toMatch(/Max-Age=\d+/);
    expect(ck.line).not.toMatch(/SameSite=Strict/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("a new Google user lands on /welcome with a pending cookie and no account rows", async () => {
    const e = email();
    const { res: s, loc } = await begin();
    const { code, state } = mock.authorize(loc, { sub: `g-${e}`, email: e });
    const before = await count("SELECT count(*)::int AS n FROM users");
    const res = await callback({ code, state }, cookieHeader(s, "__Host-hl_oidc")!.value);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/welcome");
    expect(cookieHeader(res, "__Host-hl_pending")).not.toBeNull();
    expect(cookieHeader(res, "__Host-hl_session")).toBeNull();
    expect(cookieHeader(res, "__Host-hl_oidc")!.line).toMatch(/Max-Age=0/);
    expect(await count("SELECT count(*)::int AS n FROM users")).toBe(before);
    // Accepting the gate then creates the account with a google identity.
    const pending = decodeURIComponent(cookieHeader(res, "__Host-hl_pending")!.value);
    const done = await completeSignup(deps(), pending, attest, {});
    expect(done.ok).toBe(true);
    expect(await count("SELECT count(*)::int AS n FROM auth_identities WHERE provider = 'google' AND subject = $1", [`g-${e}`])).toBe(1);
  });

  it("an existing Google user signs in, gets a rotated session cookie and goes to /you", async () => {
    const e = email();
    const { res: s1, loc: l1 } = await begin();
    const a1 = mock.authorize(l1, { sub: `g2-${e}`, email: e });
    const r1 = await callback(a1, cookieHeader(s1, "__Host-hl_oidc")!.value);
    const done = await completeSignup(deps(), decodeURIComponent(cookieHeader(r1, "__Host-hl_pending")!.value), attest, {});
    if (!done.ok) throw new Error("setup");

    const { res: s2, loc: l2 } = await begin();
    const a2 = mock.authorize(l2, { sub: `g2-${e}`, email: e });
    const r2 = await callback(a2, cookieHeader(s2, "__Host-hl_oidc")!.value, {}, `__Host-hl_session=${done.session.token}`);
    expect(new URL(r2.headers.get("location")!).pathname).toBe("/you");
    const sess = cookieHeader(r2, "__Host-hl_session")!;
    expect(sess.line).toMatch(/HttpOnly/);
    expect(sess.line).toMatch(/Secure/);
    expect(sess.line).toMatch(/SameSite=Lax/);
    expect(sess.value).not.toBe(done.session.token);
    expect(await sessionFromToken(deps(), done.session.token)).toBeNull();
    expect((await sessionFromToken(deps(), sess.value))?.userId).toBe(done.userId);
  });

  it("Google with a verified email that matches an email-code account links to it instead of making a second user", async () => {
    const e = email();
    const first = await signUpViaCode(e);
    const { res: s, loc } = await begin();
    const a = mock.authorize(loc, { sub: `g3-${e}`, email: e });
    const r = await callback(a, cookieHeader(s, "__Host-hl_oidc")!.value);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/you");
    expect((await sessionFromToken(deps(), cookieHeader(r, "__Host-hl_session")!.value))?.userId).toBe(first.userId);
    expect(await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [e])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM auth_identities WHERE user_id = $1", [first.userId])).toBe(2);
  });

  const fails = async (r: Response) => {
    expect(r.status).toBe(302);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/signin");
    expect(cookieHeader(r, "__Host-hl_session")).toBeNull();
    expect(cookieHeader(r, "__Host-hl_pending")).toBeNull();
  };

  it("fails on a wrong state, a missing cookie, a replayed code and a provider error", async () => {
    const e = email();
    const users0 = await count("SELECT count(*)::int AS n FROM users");
    const { res: s, loc } = await begin();
    const ck = cookieHeader(s, "__Host-hl_oidc")!.value;
    const a = mock.authorize(loc, { sub: `g4-${e}`, email: e });
    await fails(await callback({ code: a.code, state: "forged" }, ck));
    await fails(await callback({ code: a.code, state: a.state }, null));
    await fails(await callback({ error: "access_denied", state: a.state }, ck));
    await fails(await callback({ state: a.state }, ck));
    const ok = await callback(a, ck);
    expect(new URL(ok.headers.get("location")!).pathname).toBe("/welcome");
    await fails(await callback(a, ck)); // the code was single use
    expect(await count("SELECT count(*)::int AS n FROM users")).toBe(users0);
  });

  it("fails when the cookie was minted by a different key or is stale", async () => {
    const e = email();
    const { res: s, loc } = await begin();
    const a = mock.authorize(loc, { sub: `g5-${e}`, email: e });
    const ck = cookieHeader(s, "__Host-hl_oidc")!.value;
    await fails(await callback(a, ck, { deps: { ...deps(), keys: new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() }) } }));
    const { res: s2, loc: l2 } = await begin();
    const a2 = mock.authorize(l2, { sub: `g5b-${e}`, email: e });
    await fails(await callback(a2, cookieHeader(s2, "__Host-hl_oidc")!.value, { deps: { ...deps(), now: () => new Date(clock.getTime() + 11 * 60_000) } }));
  });

  it("fails on an unverified Google email, a wrong nonce and a token for another client", async () => {
    const e = email();
    const { res: s, loc } = await begin();
    const ck = cookieHeader(s, "__Host-hl_oidc")!.value;
    await fails(await callback(mock.authorize(loc, { sub: "u1", email: e, emailVerified: false }), ck));
    const { res: s2, loc: l2 } = await begin();
    const ck2 = cookieHeader(s2, "__Host-hl_oidc")!.value;
    const a2 = mock.authorize(l2, { sub: "u2", email: e }, { nonce: "attacker-nonce" });
    await fails(await callback(a2, ck2));
    const { res: s3, loc: l3 } = await begin();
    const a3 = mock.authorize(l3, { sub: "u3", email: e }, { aud: "another-client" });
    await fails(await callback(a3, cookieHeader(s3, "__Host-hl_oidc")!.value));
    expect(await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [e])).toBe(0);
  });

  it("start answers 503 when Google is not configured, and callback fails to /signin", async () => {
    const r = await handleGoogleStart(new Request("http://localhost:3001/auth/google/start"), ctx({ config: null }));
    expect(r.status).toBe(503);
    await fails(await callback({ code: "x", state: "y" }, "z", { config: null }));
  });
});

describe("no personal data in logs", () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  const out: string[] = [];
  beforeEach(() => {
    out.length = 0;
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      spies.push(vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(" "))));
    }
    spies.push(vi.spyOn(process.stdout, "write").mockImplementation(((s: string | Uint8Array) => (out.push(String(s)), true)) as never));
    spies.push(vi.spyOn(process.stderr, "write").mockImplementation(((s: string | Uint8Array) => (out.push(String(s)), true)) as never));
  });
  afterEach(() => {
    while (spies.length) spies.pop()!.mockRestore();
  });

  it("a full sign-up, sign-in, failure, logout and delete cycle prints no fixture address or code", async () => {
    const e = email();
    const failing = { ...deps(), sendCode: async () => Promise.reject(new Error("smtp down")) };
    await requestEmailCode(failing, { email: e, ip: "10.9.0.1" });
    tick(61_000);
    const done = await signUpViaCode(e);
    await requestEmailCode(deps(), { email: e, ip: "10.9.0.2" });
    const code = lastCode(e);
    await verifyEmailCode(deps(), { email: e, code: "000000", ip: "10.9.0.3" });
    await verifyEmailCode(deps(), { email: e, code, ip: "10.9.0.3" });
    await endSession(deps(), done.session.token);
    await deleteAccountFor(deps(), done.userId);
    const all = out.join("\n");
    expect(all).not.toContain(e);
    expect(all).not.toContain("scan-fixture");
    expect(all).not.toContain(code);
    expect(all).not.toContain(done.session.token);
  });

  it("the Google callback prints nothing identifying either", async () => {
    const mock = createMockIssuer("https://issuer.example.test", () => clock);
    const e = email();
    const c: GoogleRouteCtx = {
      deps: deps(),
      config: { issuer: mock.issuer, clientId: mock.clientId, clientSecret: mock.clientSecret, redirectUri: mock.redirectUri },
      fetch: mock.fetch,
      enabled: async () => true,
    };
    const s = await handleGoogleStart(new Request("http://localhost:3001/auth/google/start"), c);
    const a = mock.authorize(s.headers.get("location")!, { sub: `log-${e}`, email: e });
    const ck = readCookie(s.headers.getSetCookie().map((x) => x.split(";")[0]).join("; "), "__Host-hl_oidc")!;
    await handleGoogleCallback(new Request(`http://localhost:3001/auth/google/callback?code=${a.code}&state=${a.state}`, { headers: { cookie: `__Host-hl_oidc=${ck}` } }), c);
    await handleGoogleCallback(new Request(`http://localhost:3001/auth/google/callback?code=${a.code}&state=${a.state}`, { headers: { cookie: `__Host-hl_oidc=${ck}` } }), c);
    expect(out.join("\n")).not.toContain(e);
    expect(out.join("\n")).not.toContain(a.code);
  });
});
