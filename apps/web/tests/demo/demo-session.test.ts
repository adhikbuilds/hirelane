import { EnvKeyProvider, generateMasterKey } from "@hirelane/vault";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDemoSession, DEMO_SIGNIN_IP_LIMIT, DEMO_SIGNIN_GLOBAL_LIMIT } from "../../lib/auth/demo";
import { DEMO_PERSONAS } from "../../lib/demo";
import { sessionFromToken, type AuthDeps } from "../../lib/auth/session";
import { authTestDb } from "../helpers/auth-db";

let client: Client;
let close: () => Promise<void>;
const keys = new EnvKeyProvider({ HIRELANE_MASTER_KEY: generateMasterKey() });
const clock = new Date("2030-01-01T10:00:00Z");
const deps = (env: Record<string, string | undefined> = { HIRELANE_DEMO: "1", NODE_ENV: "test" }): AuthDeps => ({ db: (fn) => fn(client), keys, now: () => clock, env });

beforeAll(async () => {
  ({ client, close } = await authTestDb("hirelane_demo_session_test"));
  const mk = async (email: string) => {
    await client.query("BEGIN");
    const u = (await client.query("INSERT INTO users (email, email_verified_at, display_name) VALUES ($1, now(), 'Demo') RETURNING id", [email])).rows[0].id;
    await client.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'age_18_plus', true, 'demo')", [u]);
    await client.query("COMMIT");
  };
  for (const p of Object.values(DEMO_PERSONAS)) await mk(p.email);
  await mk("real.person@gmail.com");
});
afterAll(async () => close());

describe("startDemoSession", () => {
  it("is a refusal (not found) when the demo flag is off", async () => {
    expect(await startDemoSession(deps({ NODE_ENV: "test" }), { persona: "student", ip: "10.1.0.1" })).toEqual({ kind: "off" });
  });
  it("creates a real session for the seeded student and officer with no code", async () => {
    for (const persona of ["student", "officer"] as const) {
      const r = await startDemoSession(deps(), { persona, ip: `10.1.1.${persona.length}` });
      expect(r.kind).toBe("signed_in");
      if (r.kind !== "signed_in") return;
      const live = await sessionFromToken(deps(), r.session.token);
      const u = await client.query("SELECT email FROM users WHERE id = $1", [live!.userId]);
      expect(u.rows[0].email).toBe(DEMO_PERSONAS[persona].email);
    }
  });
  it("rejects an unknown persona and a persona that is not seeded", async () => {
    expect(await startDemoSession(deps(), { persona: "admin" as never, ip: "10.1.2.1" })).toEqual({ kind: "off" });
    await client.query("DELETE FROM users WHERE email = $1", [DEMO_PERSONAS.officer.email]);
    expect(await startDemoSession(deps(), { persona: "officer", ip: "10.1.2.2" })).toEqual({ kind: "not_seeded" });
  });
  it("is rate limited per IP", async () => {
    let last: { kind: string } = { kind: "" };
    for (let i = 0; i <= DEMO_SIGNIN_IP_LIMIT; i++) last = await startDemoSession(deps(), { persona: "student", ip: "10.1.3.1" });
    expect(last.kind).toBe("rate_limited");
    expect((await startDemoSession(deps(), { persona: "student", ip: "10.1.3.2" })).kind).toBe("signed_in");
  });
  it("has a global cap so many IPs cannot mint unlimited sessions", async () => {
    let last: { kind: string } = { kind: "" };
    for (let i = 0; i <= DEMO_SIGNIN_GLOBAL_LIMIT + 5; i++) last = await startDemoSession(deps(), { persona: "student", ip: `10.2.${Math.floor(i / 200)}.${i % 200}` });
    expect(last.kind).toBe("rate_limited");
  });
});
