import { describe, expect, it, vi } from "vitest";
import { addToWaitlist, createWaitlistHandler, waitlistInput, type WaitlistDeps } from "../lib/waitlist";

const allowed = { allowed: true, limit: 20, remaining: 19, retryAfter: 1, resetAt: new Date() };

function deps(over: Partial<WaitlistDeps> = {}): WaitlistDeps & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    limit: async () => allowed,
    save: async (v) => {
      saved.push(v);
    },
    hops: () => 0,
    ...over,
  };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3001/api/waitlist", {
    method: "POST",
    headers: { origin: "http://localhost:3001", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const good = { email: "  Asha@Example.com ", gradYear: 2026, consent: true };

describe("waitlistInput", () => {
  it("normalises the email and accepts an optional year", () => {
    expect(waitlistInput.parse(good)).toEqual({ email: "asha@example.com", gradYear: 2026, consent: true });
    expect(waitlistInput.parse({ email: "a@b.co", consent: true }).gradYear).toBeUndefined();
  });
  it("rejects bad emails, out-of-range years and missing consent", () => {
    expect(waitlistInput.safeParse({ ...good, email: "nope" }).success).toBe(false);
    expect(waitlistInput.safeParse({ ...good, gradYear: 1999 }).success).toBe(false);
    expect(waitlistInput.safeParse({ ...good, consent: false }).success).toBe(false);
    expect(waitlistInput.safeParse({ email: "a@b.co" }).success).toBe(false);
  });
});

describe("POST /api/waitlist", () => {
  it("stores a valid sign-up and returns 201", async () => {
    const d = deps();
    const res = await createWaitlistHandler(d)(post(good));
    expect(res.status).toBe(201);
    expect(d.saved).toEqual([{ email: "asha@example.com", gradYear: 2026, consent: true }]);
  });

  it("refuses cross-site and origin-less posts", async () => {
    const d = deps();
    expect((await createWaitlistHandler(d)(post(good, { origin: "https://evil.example" }))).status).toBe(403);
    const noOrigin = new Request("http://localhost:3001/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(good) });
    expect((await createWaitlistHandler(d)(noOrigin)).status).toBe(403);
    expect(d.saved).toEqual([]);
  });

  it("refuses non-JSON, oversized and malformed bodies", async () => {
    const d = deps();
    expect((await createWaitlistHandler(d)(post("x", { "content-type": "text/plain" }))).status).toBe(415);
    expect((await createWaitlistHandler(d)(post({ ...good, pad: "x".repeat(3000) }))).status).toBe(413);
    expect((await createWaitlistHandler(d)(post("{not json"))).status).toBe(400);
    const bad = await createWaitlistHandler(d)(post({ ...good, consent: false }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.param).toBe("consent");
    expect(d.saved).toEqual([]);
  });

  it("returns 429 with Retry-After when the bucket is full", async () => {
    const d = deps({ limit: async () => ({ ...allowed, allowed: false, remaining: 0, retryAfter: 42 }) });
    const res = await createWaitlistHandler(d)(post(good));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(d.saved).toEqual([]);
  });

  it("fails closed when the limiter is down, and never logs the address", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ limit: async () => { throw new Error("db down"); } });
    expect((await createWaitlistHandler(d)(post(good))).status).toBe(503);
    const failing = deps({ save: async () => { throw new Error("insert asha@example.com failed"); } });
    expect((await createWaitlistHandler(failing)(post(good))).status).toBe(500);
    const busy = deps({ limit: async () => ({ ...allowed, allowed: false, busy: true, retryAfter: 5 }) });
    const busyRes = await createWaitlistHandler(busy)(post(good));
    expect(busyRes.status).toBe(503);
    expect(busyRes.headers.get("retry-after")).toBe("5");
    expect(busy.saved).toEqual([]);
    expect(JSON.stringify(err.mock.calls)).not.toContain("asha@example.com");
    err.mockRestore();
  });
});

describe("addToWaitlist", () => {
  it("inserts with a case-insensitive no-op on conflict", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const now = new Date("2026-10-19T00:00:00Z");
    await addToWaitlist({ query }, { email: "a@b.co", consent: true }, now);
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("ON CONFLICT ((lower(email))) DO NOTHING");
    expect(values).toEqual(["a@b.co", null, "landing", now]);
  });
});
