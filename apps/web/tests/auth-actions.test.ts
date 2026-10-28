import { generateMasterKey } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authTestDb } from "./helpers/auth-db";

// Server actions, end to end against a real database. Only the Next request plumbing and the mail transport are faked.
const jar = new Map<string, string>();
let reqHeaders: Record<string, string> = {};
const sent: { to: string; code: string }[] = [];

vi.mock("next/headers", () => ({
  headers: async () => new Headers(reqHeaders),
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string, o: { maxAge?: number }) => (o?.maxAge === 0 || v === "" ? jar.delete(n) : jar.set(n, v)),
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("../lib/auth/deps", async () => {
  const s = await import("../lib/auth/session");
  return { defaultEmailCodeDeps: () => ({ ...s.defaultAuthDeps(), sendCode: async (to: string, code: string) => void sent.push({ to, code }) }) };
});

let client: Client;
let close: () => Promise<void>;
let closePool: () => Promise<void>;
let n = 0;
const email = () => `action-fixture-${++n}-${Math.random().toString(36).slice(2, 8)}@example.test`;
const redirected = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return m[1]!;
    throw e;
  }
  throw new Error("expected a redirect");
};
const count = async (sql: string, p: unknown[] = []) => (await client.query(sql, p)).rows[0].n as number;

beforeAll(async () => {
  const db = await authTestDb("hirelane_auth_actions_test");
  client = db.client;
  close = db.close;
  process.env["DATABASE_URL"] = db.url;
  process.env["HIRELANE_MASTER_KEY"] = generateMasterKey();
  const dbMod = await import("@hirelane/db");
  closePool = dbMod.close;
});
afterAll(async () => {
  await closePool();
  await close();
  delete process.env["HIRELANE_ACCOUNTS"];
});
beforeEach(() => {
  jar.clear();
  sent.length = 0;
  process.env["HIRELANE_ACCOUNTS"] = "1";
  reqHeaders = { origin: "http://localhost:3001", host: "localhost:3001", "user-agent": "vitest", "x-forwarded-for": "10.20.0.1" };
});
afterEach(() => vi.restoreAllMocks());

describe("accounts flag and origin", () => {
  it("flag off: every action is a 404", async () => {
    process.env["HIRELANE_ACCOUNTS"] = "0";
    const [si, co, we, yo] = await Promise.all([
      import("../app/(auth)/signin/actions"),
      import("../app/(auth)/signin/code/actions"),
      import("../app/(auth)/welcome/actions"),
      import("../app/(app)/you/actions"),
    ]);
    await expect(si.sendEmailCode({ email: "a@example.test" })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(co.verifyCode({ email: "a@example.test", code: "123456" })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(we.acceptSignup({ over18: true, terms: true, privacy: true })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(we.declineSignup()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(yo.logout()).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(yo.deleteMyAccount({ confirm: true })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(yo.setConsent({ kind: "analytics", granted: true })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(sent).toHaveLength(0);
  });

  it("a cross-origin or origin-less post is refused and does nothing", async () => {
    const { sendEmailCode } = await import("../app/(auth)/signin/actions");
    const { logout } = await import("../app/(app)/you/actions");
    for (const h of [{ origin: "https://evil.example.test", host: "localhost:3001" }, { host: "localhost:3001" }]) {
      reqHeaders = h as Record<string, string>;
      expect(await sendEmailCode({ email: email() })).toEqual({ ok: false, reason: "bad_origin" });
      expect(await logout()).toEqual({ ok: false, reason: "bad_origin" });
    }
    expect(sent).toHaveLength(0);
  });
});

describe("sign up, sign in, logout, delete through the actions", () => {
  it("runs the whole journey and keeps the invariants", async () => {
    const { sendEmailCode } = await import("../app/(auth)/signin/actions");
    const { verifyCode } = await import("../app/(auth)/signin/code/actions");
    const { acceptSignup, getPendingSignup } = await import("../app/(auth)/welcome/actions");
    const { logout, setConsent, deleteMyAccount } = await import("../app/(app)/you/actions");
    const { getSession } = await import("../lib/session");
    const e = email();

    expect(await sendEmailCode({ email: e })).toEqual({ ok: true });
    expect(await verifyCode({ email: e, code: "000000" })).toEqual({ ok: false, reason: "invalid_code" });
    expect(await redirected(verifyCode({ email: e, code: sent.at(-1)!.code }))).toBe("/welcome");
    expect(await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [e])).toBe(0);
    expect(await getPendingSignup()).toEqual({ email: e, provider: "email_otp" });
    expect(await getSession()).toBeNull();

    expect(await acceptSignup({ over18: true, terms: true, privacy: false })).toEqual({ ok: false, reason: "consent_required" });
    expect(await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [e])).toBe(0);
    expect(await redirected(acceptSignup({ over18: true, terms: true, privacy: true }))).toBe("/you");
    const me = await getSession();
    expect(me?.userId).toBeTruthy();
    expect(jar.has("__Host-hl_pending")).toBe(false);
    expect(await count("SELECT count(*)::int AS n FROM consents WHERE user_id = $1 AND kind = 'age_18_plus' AND granted", [me!.userId])).toBe(1);

    expect(await setConsent({ kind: "campus_share", granted: true })).toEqual({ ok: true });
    expect(await count("SELECT count(*)::int AS n FROM consents WHERE user_id = $1 AND kind = 'campus_share'", [me!.userId])).toBe(1);
    // The 18+ attestation can only be written at sign-up.
    expect(await setConsent({ kind: "age_18_plus" as never, granted: false })).toEqual({ ok: false, reason: "unknown_kind" });

    const token = jar.get("__Host-hl_session")!;
    expect(await redirected(logout())).toBe("/signin");
    expect(jar.has("__Host-hl_session")).toBe(false);
    const row = await client.query("SELECT revoked_at FROM sessions WHERE user_id = $1", [me!.userId]);
    expect(row.rows[0].revoked_at).not.toBeNull();
    // Replaying the old cookie after logout gets nothing.
    jar.set("__Host-hl_session", token);
    expect(await getSession()).toBeNull();

    // Sign back in, then delete. (The real clock is in use, so clear the 60 s resend cooldown.)
    await client.query("DELETE FROM rate_limits WHERE bucket LIKE 'otp-cooldown:%'");
    await sendEmailCode({ email: e });
    expect(await redirected(verifyCode({ email: e, code: sent.at(-1)!.code }))).toBe("/you");
    expect((await getSession())?.userId).toBe(me!.userId);
    expect(await deleteMyAccount({ confirm: false })).toEqual({ ok: false, reason: "not_confirmed" });
    expect(await redirected(deleteMyAccount({ confirm: true }))).toBe("/");
    expect(await count("SELECT count(*)::int AS n FROM users WHERE id = $1", [me!.userId])).toBe(0);
    expect(await getSession()).toBeNull();
  });

  it("under 18 stores nothing and clears the pending cookie", async () => {
    const { sendEmailCode } = await import("../app/(auth)/signin/actions");
    const { verifyCode } = await import("../app/(auth)/signin/code/actions");
    const { acceptSignup, getPendingSignup } = await import("../app/(auth)/welcome/actions");
    const e = email();
    await sendEmailCode({ email: e });
    await redirected(verifyCode({ email: e, code: sent.at(-1)!.code }));
    expect(jar.has("__Host-hl_pending")).toBe(true);
    expect(await acceptSignup({ over18: false, terms: true, privacy: true })).toEqual({ ok: false, reason: "under_18" });
    expect(jar.has("__Host-hl_pending")).toBe(false);
    expect(await getPendingSignup()).toBeNull();
    expect(await count("SELECT count(*)::int AS n FROM users WHERE email = $1", [e])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM auth_identities")).toBe(await count("SELECT count(DISTINCT user_id)::int AS n FROM auth_identities"));
  });

  it("getPendingSignup works on a plain navigation GET (no Origin header)", async () => {
    const { sendEmailCode } = await import("../app/(auth)/signin/actions");
    const { verifyCode } = await import("../app/(auth)/signin/code/actions");
    const { getPendingSignup } = await import("../app/(auth)/welcome/actions");
    const e = email();
    await sendEmailCode({ email: e });
    await redirected(verifyCode({ email: e, code: sent.at(-1)!.code }));
    reqHeaders = { host: "localhost:3001" };
    expect(await getPendingSignup()).toEqual({ email: e, provider: "email_otp" });
    process.env["HIRELANE_ACCOUNTS"] = "0";
    await expect(getPendingSignup()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("signed-out calls to account actions are refused", async () => {
    const { deleteMyAccount, setConsent } = await import("../app/(app)/you/actions");
    expect(await deleteMyAccount({ confirm: true })).toEqual({ ok: false, reason: "signed_out" });
    expect(await setConsent({ kind: "analytics", granted: true })).toEqual({ ok: false, reason: "signed_out" });
  });
});
