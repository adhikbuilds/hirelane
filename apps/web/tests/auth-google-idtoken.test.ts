import { describe, expect, it } from "vitest";
import { verifyIdToken } from "../lib/auth/google";
import { createMockIssuer } from "./helpers/mock-oidc";

const NOW = new Date("2030-01-01T10:00:00Z");
const sec = Math.floor(NOW.getTime() / 1000);

function setup() {
  const m = createMockIssuer();
  const cfg = { issuer: m.issuer, clientId: m.clientId, clientSecret: m.clientSecret, redirectUri: m.redirectUri };
  const good = { iss: m.issuer, aud: m.clientId, sub: "sub-1", email: "g@example.test", email_verified: true, nonce: "n-1", iat: sec, exp: sec + 300 };
  const check = (token: string, nonce = "n-1") => verifyIdToken(token, { config: cfg, fetch: m.fetch, nonce, now: NOW });
  return { m, good, check };
}

describe("verifyIdToken", () => {
  it("accepts a correct RS256 token and returns the identity", async () => {
    const { m, good, check } = setup();
    expect(await check(m.mint(good))).toEqual({ ok: true, sub: "sub-1", email: "g@example.test" });
  });

  it("accepts the bare accounts.google.com issuer form when the issuer is Google", async () => {
    const { m, good } = setup();
    const google = { issuer: "https://accounts.google.com", clientId: m.clientId, clientSecret: "s", redirectUri: m.redirectUri };
    const r = await verifyIdToken(m.mint({ ...good, iss: "accounts.google.com" }), {
      config: google,
      fetch: m.fetch,
      nonce: "n-1",
      now: NOW,
      jwksUri: `${m.issuer}/jwks`,
    });
    expect(r.ok).toBe(true);
  });

  const bad: [string, (g: Record<string, unknown>) => Record<string, unknown>][] = [
    ["wrong issuer", (g) => ({ ...g, iss: "https://evil.example.test" })],
    ["wrong audience", (g) => ({ ...g, aud: "someone-else" })],
    ["audience list without us", (g) => ({ ...g, aud: ["a", "b"] })],
    ["expired", (g) => ({ ...g, exp: sec - 120 })],
    ["issued in the future", (g) => ({ ...g, iat: sec + 3600, exp: sec + 7200 })],
    ["wrong nonce", (g) => ({ ...g, nonce: "other" })],
    ["missing nonce", (g) => ({ ...g, nonce: undefined })],
    ["unverified email", (g) => ({ ...g, email_verified: false })],
    ["email_verified missing", (g) => ({ ...g, email_verified: undefined })],
    ["missing email", (g) => ({ ...g, email: undefined })],
    ["missing sub", (g) => ({ ...g, sub: "" })],
    ["missing exp", (g) => ({ ...g, exp: undefined })],
  ];
  for (const [name, mutate] of bad) {
    it(`rejects ${name}`, async () => {
      const { m, good, check } = setup();
      expect((await check(m.mint(mutate(good)))).ok).toBe(false);
    });
  }

  it("rejects alg none, HS256 and an unknown kid", async () => {
    const { m, good, check } = setup();
    expect((await check(m.mint(good, { alg: "none" }))).ok).toBe(false);
    expect((await check(m.mint(good, { alg: "HS256" }))).ok).toBe(false);
    expect((await check(m.mint(good, { kid: "nope" }))).ok).toBe(false);
  });

  it("rejects a token signed with a different key", async () => {
    const { m, good, check } = setup();
    expect((await check(m.mint(good, { key: m.otherKey }))).ok).toBe(false);
  });

  it("rejects a tampered payload and malformed tokens", async () => {
    const { m, good, check } = setup();
    const [h, , s] = m.mint(good).split(".");
    const forged = Buffer.from(JSON.stringify({ ...good, sub: "admin" })).toString("base64url");
    expect((await check(`${h}.${forged}.${s}`)).ok).toBe(false);
    for (const junk of ["", "a.b", "a.b.c.d", "...", "not-a-jwt"]) expect((await check(junk)).ok, junk).toBe(false);
  });

  it("fails closed when the key set cannot be fetched", async () => {
    const { m, good } = setup();
    const down = (async () => new Response("no", { status: 500 })) as typeof fetch;
    const r = await verifyIdToken(m.mint(good), {
      config: { issuer: m.issuer, clientId: m.clientId, clientSecret: "x", redirectUri: m.redirectUri },
      fetch: down,
      nonce: "n-1",
      now: NOW,
    });
    expect(r.ok).toBe(false);
  });
});
