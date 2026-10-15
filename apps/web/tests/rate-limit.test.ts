import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, close, withAdmin } from "@hirelane/db";
import { checkRateLimit, clientIp, trustProxyHops } from "../lib/rate-limit";

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
    expect(clientIp(h("9.9.9.9"), { hops: 0 })).toBe("unknown");
    expect(clientIp(h(), { hops: 0, socketAddress: "10.0.0.7" })).toBe("10.0.0.7");
  });

  it("with N hops takes the Nth entry from the right, so a spoofed left entry is ignored", () => {
    expect(clientIp(h("9.9.9.9, 5.6.7.8"), { hops: 1 })).toBe("5.6.7.8");
    expect(clientIp(h("6.6.6.6, 9.9.9.9, 5.6.7.8"), { hops: 2 })).toBe("9.9.9.9");
    expect(clientIp(h("5.6.7.8"), { hops: 1 })).toBe("5.6.7.8");
  });

  it("is unknown when the chain is shorter than the trusted hops, or the entry is not an IP", () => {
    expect(clientIp(h("5.6.7.8"), { hops: 2 })).toBe("unknown");
    expect(clientIp(h(), { hops: 1 })).toBe("unknown");
    expect(clientIp(h("1.1.1.1, not-an-ip"), { hops: 1 })).toBe("unknown");
    expect(clientIp(h("1.1.1.1, 999.1.1.1"), { hops: 1 })).toBe("unknown");
    expect(clientIp(h(""), { hops: 1 })).toBe("unknown");
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
