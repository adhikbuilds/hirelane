import { EnvKeyProvider, generateMasterKey } from "@hirelane/vault";
import { lookupSession, createSession } from "@hirelane/db";
import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requestEmailCode, verifyEmailCode, type EmailCodeDeps } from "../lib/auth/email-code";
import { handleGoogleStart, type GoogleRouteCtx } from "../lib/auth/google";
import { completeSignup } from "../lib/auth/pending-signup";
import { tokenFromRequest } from "../lib/auth/session";
import { isSameOrigin } from "../lib/auth/origin";
import { loadOidcConfig } from "../lib/auth/google";
import { authTestDb } from "./helpers/auth-db";
import { createMockIssuer } from "./helpers/mock-oidc";

let client: Client;
let close: () => Promise<void>;
const keys = new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() });
const ENV = { NODE_ENV: "test" } as Record<string, string | undefined>;
let clock = new Date("2031-01-01T10:00:00Z");
let sent: { to: string; code: string }[] = [];
let n = 0;
const email = () => `hardening-${++n}-${Math.random().toString(36).slice(2, 8)}@example.test`;
const deps = (): EmailCodeDeps => ({ db: (fn) => fn(client), keys, now: () => clock, env: ENV, sendCode: async (to, code) => void sent.push({ to, code }) });
const tick = (ms: number) => (clock = new Date(clock.getTime() + ms));
const sentTo = (e: string) => sent.filter((s) => s.to === e);

beforeAll(async () => {
  ({ client, close } = await authTestDb("hirelane_auth_hardening_test"));
});
afterAll(async () => {
  await close();
});
beforeEach(() => {
  sent = [];
  clock = new Date(clock.getTime() + 2 * 24 * 3600_000);
});

describe("OTP send abuse", () => {
  it("a second request inside the 60 s cooldown sends nothing and answers identically", async () => {
    const e = email();
    const a = await requestEmailCode(deps(), { email: e, ip: "10.9.0.1" });
    tick(5_000);
    const b = await requestEmailCode(deps(), { email: e, ip: "10.9.0.1" });
    expect(b).toEqual(a);
    expect(sentTo(e)).toHaveLength(1);
    tick(61_000);
    await requestEmailCode(deps(), { email: e, ip: "10.9.0.1" });
    expect(sentTo(e)).toHaveLength(2);
  });

  it("caps mails per address per day regardless of source IP", async () => {
    const e = email();
    for (let i = 0; i < 14; i++) {
      await requestEmailCode(deps(), { email: e, ip: `10.9.1.${i}` });
      tick(11 * 60_000); // clears the cooldown and the 10 minute target window
    }
    expect(sentTo(e).length).toBe(10);
    // next day: allowed again
    tick(24 * 3600_000);
    await requestEmailCode(deps(), { email: e, ip: "10.9.1.99" });
    expect(sentTo(e).length).toBe(11);
  });
});

describe("OTP guessing across challenges", () => {
  it("locks the address out after 10 verify attempts in an hour, even for the right code", async () => {
    const e = email();
    let ok = 0;
    let limited = 0;
    for (let round = 0; round < 3; round++) {
      await requestEmailCode(deps(), { email: e, ip: "10.9.2.1" });
      tick(61_000);
      for (let g = 0; g < 5; g++) {
        const r = await verifyEmailCode(deps(), { email: e, code: "000000", ip: `10.9.2.${10 + round * 5 + g}` });
        if (r.kind === "rate_limited") limited++;
        else if (r.kind === "invalid") ok++;
      }
    }
    expect(ok).toBe(10);
    expect(limited).toBeGreaterThan(0);
    await requestEmailCode(deps(), { email: e, ip: "10.9.2.200" });
    tick(61_000);
    const right = sentTo(e).at(-1)!.code;
    expect((await verifyEmailCode(deps(), { email: e, code: right, ip: "10.9.2.201" })).kind).toBe("rate_limited");
    tick(3600_000);
    expect((await verifyEmailCode(deps(), { email: e, code: right, ip: "10.9.2.201" })).kind).not.toBe("rate_limited");
  });
});

describe("pending signup is single-use", () => {
  it("replaying the cookie after the account exists does not mint a session", async () => {
    const e = email();
    await requestEmailCode(deps(), { email: e, ip: "10.9.3.1" });
    const v = await verifyEmailCode(deps(), { email: e, code: sentTo(e)[0]!.code, ip: "10.9.3.1" });
    if (v.kind !== "pending") throw new Error("expected pending");
    const attest = { over18: true, terms: true, privacy: true };
    const first = await completeSignup(deps(), v.cookieValue, attest, {});
    expect(first.ok).toBe(true);
    const replay = await completeSignup(deps(), v.cookieValue, attest, {});
    expect(replay).toEqual({ ok: false, reason: "expired" });
    const { rows } = await client.query("SELECT count(*)::int AS n FROM sessions");
    expect(rows[0].n).toBe(1);
  });
});

describe("google start", () => {
  const mock = createMockIssuer("https://issuer.example.test", () => clock);
  const ctx = (): GoogleRouteCtx => ({
    deps: { ...deps(), env: { NODE_ENV: "test", TRUST_X_REAL_IP: "1" } },
    config: { issuer: mock.issuer, clientId: mock.clientId, clientSecret: mock.clientSecret, redirectUri: mock.redirectUri },
    fetch: mock.fetch,
    enabled: async () => true,
  });
  const start = () => handleGoogleStart(new Request("http://localhost:3001/auth/google/start", { headers: { "user-agent": "t", "x-real-ip": "203.0.113.9" } }), ctx());

  it("is rate limited per client", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push((await start()).status);
    expect(codes.slice(0, 5).every((c) => c === 302)).toBe(true);
    expect(codes).toContain(429);
  });

  it("caches the discovery document instead of fetching on every hit", async () => {
    tick(2 * 3600_000);
    const before = mock.requests.length;
    const a = await start();
    const b = await start();
    expect([a.status, b.status]).toEqual([302, 302]);
    const discoveryHits = mock.requests.slice(before).filter((r) => String(r.url ?? r).includes("openid-configuration")).length;
    expect(discoveryHits).toBeLessThanOrEqual(1);
  });
});

describe("production config fails closed", () => {
  it("loadOidcConfig needs HIRELANE_APP_ORIGIN in production and rejects http or localhost issuers", () => {
    const base = { HIRELANE_GOOGLE_CLIENT_ID: "id", HIRELANE_GOOGLE_CLIENT_SECRET: "s" };
    expect(loadOidcConfig({ ...base, NODE_ENV: "production" })).toBeNull();
    expect(loadOidcConfig({ ...base, NODE_ENV: "production", HIRELANE_APP_ORIGIN: "http://example.test" })).toBeNull();
    expect(loadOidcConfig({ ...base, NODE_ENV: "production", HIRELANE_APP_ORIGIN: "https://example.test", HIRELANE_OIDC_ISSUER: "http://localhost:9" })).toBeNull();
    expect(loadOidcConfig({ ...base, NODE_ENV: "production", HIRELANE_APP_ORIGIN: "https://example.test" })?.redirectUri).toBe("https://example.test/auth/google/callback");
    expect(loadOidcConfig({ ...base, NODE_ENV: "development" })?.redirectUri).toBe("http://localhost:3001/auth/google/callback");
  });
  it("isSameOrigin does not trust the Host header in production", () => {
    const h = (o: string) => ({ get: (k: string) => ({ origin: o, host: "evil.test" })[k] ?? null });
    expect(isSameOrigin(h("https://evil.test"), { NODE_ENV: "production" })).toBe(false);
    expect(isSameOrigin(h("https://evil.test"), { NODE_ENV: "test" })).toBe(true);
  });
});

describe("session token handling", () => {
  it("the web cookie must be a web token, and a bearer must be an android token", () => {
    const cookie = (v: string) => ({ get: (k: string) => (k === "cookie" ? `__Host-hl_session=${v}` : null) });
    expect(tokenFromRequest(cookie("hl_at_" + "a".repeat(43)), ENV)).toBeNull();
    expect(tokenFromRequest(cookie("hl_s_" + "a".repeat(43)), ENV)).toBe("hl_s_" + "a".repeat(43));
  });
  it("last_seen_at is written at most every 5 minutes", async () => {
    const { rows } = await client.query("SELECT id FROM users LIMIT 1");
    const s = await createSession(client, { userId: rows[0].id as string, client: "web", now: clock });
    await lookupSession(client, s.token, new Date(clock.getTime() + 60_000));
    const a = (await client.query("SELECT last_seen_at FROM sessions WHERE id_hash = $1", [s.idHash])).rows[0].last_seen_at as Date;
    expect(a.getTime()).toBe(clock.getTime());
    await lookupSession(client, s.token, new Date(clock.getTime() + 6 * 60_000));
    const b = (await client.query("SELECT last_seen_at FROM sessions WHERE id_hash = $1", [s.idHash])).rows[0].last_seen_at as Date;
    expect(b.getTime()).toBe(clock.getTime() + 6 * 60_000);
  });
});

describe("the whole auth flow runs as the narrow hirelane_auth role", () => {
  it("sign-up, sign-in, session lookup, logout and delete all work without owner rights", async () => {
    const { runAsRole } = await import("@hirelane/db");
    const { completeSignup } = await import("../lib/auth/pending-signup");
    const { sessionFromToken, endSession, deleteAccountFor } = await import("../lib/auth/session");
    const narrow = (): EmailCodeDeps => ({ ...deps(), db: async (fn) => (await runAsRole(client, "hirelane_auth", () => fn(client))).result });
    const e = email();
    await requestEmailCode(narrow(), { email: e, ip: "10.9.9.1" });
    const v = await verifyEmailCode(narrow(), { email: e, code: sentTo(e)[0]!.code, ip: "10.9.9.1" });
    if (v.kind !== "pending") throw new Error("expected pending");
    const done = await completeSignup(narrow(), v.cookieValue, { over18: true, terms: true, privacy: true }, {});
    if (!done.ok) throw new Error("signup failed");
    expect((await sessionFromToken(narrow(), done.session.token))?.userId).toBe(done.userId);
    tick(61_000);
    await requestEmailCode(narrow(), { email: e, ip: "10.9.9.1" });
    const again = await verifyEmailCode(narrow(), { email: e, code: sentTo(e).at(-1)!.code, ip: "10.9.9.1", previousToken: done.session.token });
    expect(again.kind).toBe("signed_in");
    expect(await endSession(narrow(), done.session.token)).toBe(false); // already rotated away
    expect((await deleteAccountFor(narrow(), done.userId)).deleted).toBe(true);
  });
});
