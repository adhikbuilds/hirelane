import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, close, withAdmin } from "@hirelane/db";
import { checkRateLimit, clientIp, guardedLimit, isLocalKey, scaledLimit, trustProxyHops } from "../lib/rate-limit";

const h = (xff?: string) => new Headers(xff === undefined ? {} : { "x-forwarded-for": xff });

describe("trustProxyHops", () => {
  it("defaults to 0 and rejects anything that is not a small non-negative integer", () => {
    expect(trustProxyHops({})).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "" })).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "abc" })).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "-1" })).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "1.5" })).toBe(0);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "1" })).toBe(1);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "2" })).toBe(2);
    expect(trustProxyHops({ TRUST_PROXY_HOPS: "99" })).toBe(0);
  });
});

describe("clientIp", () => {
  it("with 0 hops never reads X-Forwarded-For, even when a client sends one", () => {
    expect(clientIp(h("9.9.9.9"), { hops: 0, socketAddress: "10.0.0.7" })).toBe("10.0.0.7");
    expect(clientIp(h("9.9.9.9"), { hops: 0 })).toBe("local");
    expect(clientIp(h(), { hops: 0, socketAddress: "10.0.0.7" })).toBe("10.0.0.7");
  });

  it("with N hops takes the Nth entry from the right, so a spoofed left entry is ignored", () => {
    expect(clientIp(h("9.9.9.9, 5.6.7.8"), { hops: 1 })).toBe("5.6.7.8");
    expect(clientIp(h("6.6.6.6, 9.9.9.9, 5.6.7.8"), { hops: 2 })).toBe("9.9.9.9");
    expect(clientIp(h("5.6.7.8"), { hops: 1 })).toBe("5.6.7.8");
  });

  it("falls back to the local key (never the spoofable entry) when the chain is shorter than the trusted hops, or the entry is not an IP", () => {
    expect(clientIp(h("5.6.7.8"), { hops: 2 })).toBe("local");
    expect(clientIp(h(), { hops: 1 })).toBe("local");
    expect(clientIp(h("1.1.1.1, not-an-ip"), { hops: 1 })).toBe("local");
    expect(clientIp(h("1.1.1.1, 999.1.1.1"), { hops: 1 })).toBe("local");
    expect(clientIp(h(""), { hops: 1 })).toBe("local");
  });

  it("normalises IPv4-mapped IPv6, ports and surrounding space", () => {
    expect(clientIp(h("x, ::ffff:5.6.7.8"), { hops: 1 })).toBe("5.6.7.8");
    expect(clientIp(h("  5.6.7.8:443 "), { hops: 1 })).toBe("5.6.7.8");
    expect(clientIp(h(), { hops: 0, socketAddress: "::ffff:127.0.0.1" })).toBe("127.0.0.1");
  });

  it("buckets an IPv6 address by its /64 so rotating the host part does not dodge the limit", () => {
    const a = clientIp(h("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), { hops: 1 });
    const b = clientIp(h("2001:0db8:0001:0002::1"), { hops: 1 });
    expect(a).toBe("2001:db8:1:2::/64");
    expect(b).toBe(a);
    expect(clientIp(h("2001:db8:1:3::1"), { hops: 1 })).not.toBe(a);
    expect(clientIp(h("::1"), { hops: 1 })).toBe("0:0:0:0::/64");
  });
});

describe("clientIp without a proxy count (SEC-1)", () => {
  const prod = { NODE_ENV: "production" };
  const dev = { NODE_ENV: "development" };
  const hdr = (o: Record<string, string>) => new Headers(o);

  const trusted = { NODE_ENV: "production", TRUST_X_REAL_IP: "1" };

  it("trusts x-real-ip only when TRUST_X_REAL_IP=1", () => {
    expect(clientIp(hdr({ "x-real-ip": "5.6.7.8", "x-forwarded-for": "9.9.9.9" }), { hops: 0, env: trusted })).toBe("5.6.7.8");
    expect(clientIp(hdr({ "x-real-ip": "2001:db8:1:2::9" }), { hops: 0, env: trusted })).toBe("2001:db8:1:2::/64");
  });

  it("never reads a client-supplied x-real-ip without the opt-in (no fresh bucket per request)", () => {
    const a = clientIp(hdr({ "x-real-ip": "5.6.7.8", "user-agent": "u" }), { hops: 0, env: prod });
    const b = clientIp(hdr({ "x-real-ip": "5.6.7.9", "user-agent": "u" }), { hops: 0, env: prod });
    expect(a).toMatch(/^anon:/);
    expect(a).toBe(b);
    expect(clientIp(hdr({ "x-real-ip": "5.6.7.8" }), { hops: 0, env: dev })).toBe("local");
    // hops configured does not turn x-real-ip on
    expect(clientIp(hdr({ "x-real-ip": "7.7.7.7", "x-forwarded-for": "1.1.1.1, 5.6.7.8" }), { hops: 1, env: prod })).toBe("5.6.7.8");
    expect(clientIp(hdr({ "x-real-ip": "7.7.7.7" }), { hops: 0, env: { ...prod, TRUST_X_REAL_IP: "0" } })).toMatch(/^anon:/);
  });

  it("ignores a malformed x-real-ip and falls through to the hop-based chain", () => {
    expect(clientIp(hdr({ "x-real-ip": "nope", "x-forwarded-for": "1.1.1.1, 5.6.7.8" }), { hops: 1, env: trusted })).toBe("5.6.7.8");
  });

  it("uses the socket address before any fallback", () => {
    expect(clientIp(hdr({}), { hops: 0, socketAddress: "10.0.0.7", env: prod })).toBe("10.0.0.7");
  });

  it("in development/test with no address uses a shared local key, not 'unknown'", () => {
    expect(clientIp(hdr({}), { hops: 0, env: dev })).toBe("local");
    expect(clientIp(hdr({}), { hops: 0, env: { NODE_ENV: "test" } })).toBe("local");
    expect(isLocalKey("local")).toBe(true);
    expect(isLocalKey("5.6.7.8")).toBe(false);
  });

  it("in production never collapses to one global bucket: buckets by a header fingerprint", () => {
    const a = clientIp(hdr({ "user-agent": "curl/8", "accept-language": "en" }), { hops: 0, env: prod });
    const b = clientIp(hdr({ "user-agent": "Mozilla/5.0", "accept-language": "de" }), { hops: 0, env: prod });
    expect(a).toMatch(/^anon:[0-9a-f]{16}$/);
    expect(b).toMatch(/^anon:[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
    expect(clientIp(hdr({ "user-agent": "curl/8", "accept-language": "en" }), { hops: 0, env: prod })).toBe(a);
    expect(a).not.toBe("unknown");
    expect(isLocalKey(a)).toBe(false);
  });

  it("scaledLimit widens the budget only for the local key", () => {
    expect(scaledLimit("local", 60)).toBeGreaterThan(60);
    expect(scaledLimit("5.6.7.8", 60)).toBe(60);
  });
});

describe("guardedLimit (SEC-5)", () => {
  it("passes a normal result through", async () => {
    const ok = { allowed: true, limit: 5, remaining: 4, retryAfter: 1, resetAt: new Date() };
    expect(await guardedLimit(async () => ok)).toBe(ok);
  });

  it("turns a limiter failure into a typed busy result, without leaking the error", async () => {
    const r = await guardedLimit(async () => { throw new Error("password=hunter2"); }, { log: () => {} });
    expect(r).toMatchObject({ allowed: false, busy: true });
    expect(r.retryAfter).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(r)).not.toContain("hunter2");
  });
});

const BASE = process.env["TEST_DATABASE_URL"] ?? "postgres://hirelane:hirelane@localhost:5433/hirelane_test";
const DB_NAME = "hirelane_rate_limit_test";
const MIGRATIONS = resolve(fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url)));

describe("checkRateLimit", () => {
  beforeAll(async () => {
    if (!/@(localhost|127\.0\.0\.1)[:/]/.test(BASE)) throw new Error("refusing to run against a non-local database");
    process.env["DATABASE_URL"] = BASE;
    await withAdmin(async (c) => {
      const { rowCount } = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
      if (!rowCount) await c.query(`CREATE DATABASE ${DB_NAME}`);
    });
    await close();
    const u = new URL(BASE);
    u.pathname = `/${DB_NAME}`;
    process.env["DATABASE_URL"] = u.toString();
    await withAdmin(async (c) => {
      await c.query("DROP SCHEMA public CASCADE");
      await c.query("CREATE SCHEMA public");
      await applyMigrations(c, MIGRATIONS);
    });
  }, 60_000);
  afterAll(async () => {
    await close();
  });

  const T0 = new Date("2026-10-16T10:00:20Z");

  it("allows up to the limit inside a window, then blocks with Retry-After to the window end", async () => {
    await withAdmin(async (c) => {
      const results = [];
      for (let i = 0; i < 4; i++) results.push(await checkRateLimit(c, "t:a", { limit: 3, windowSeconds: 60, now: T0 }));
      expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
      expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
      expect(results[3]?.retryAfter).toBe(40);
      expect(results[3]?.limit).toBe(3);
    });
  });

  it("keeps buckets independent and resets in the next window", async () => {
    await withAdmin(async (c) => {
      expect((await checkRateLimit(c, "t:b", { limit: 1, windowSeconds: 60, now: T0 })).allowed).toBe(true);
      expect((await checkRateLimit(c, "t:b", { limit: 1, windowSeconds: 60, now: T0 })).allowed).toBe(false);
      expect((await checkRateLimit(c, "t:c", { limit: 1, windowSeconds: 60, now: T0 })).allowed).toBe(true);
      const later = new Date(T0.getTime() + 60_000);
      expect((await checkRateLimit(c, "t:b", { limit: 1, windowSeconds: 60, now: later })).allowed).toBe(true);
    });
  });

  it("counts concurrent requests exactly", async () => {
    await withAdmin(async () => undefined);
    const { getPool } = await import("@hirelane/db");
    const res = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const c = await getPool().connect();
        try {
          return await checkRateLimit(c, "t:race", { limit: 5, windowSeconds: 60, now: T0 });
        } finally {
          c.release();
        }
      }),
    );
    expect(res.filter((r) => r.allowed)).toHaveLength(5);
  });

  it("deletes stale windows when asked to prune", async () => {
    await withAdmin(async (c) => {
      await c.query("INSERT INTO rate_limits (bucket, window_start, count) VALUES ('t:old', $1, 1)", [new Date(T0.getTime() - 7_200_000)]);
      await checkRateLimit(c, "t:prune", { limit: 5, windowSeconds: 60, now: T0, prune: true });
      const { rowCount } = await c.query("SELECT 1 FROM rate_limits WHERE bucket = 't:old'");
      expect(rowCount).toBe(0);
    });
  });
});
