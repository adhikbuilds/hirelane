import { describe, expect, it, vi } from "vitest";
import { createAutopilotHandler, type AutopilotDeps } from "../app/api/public/stats/autopilot/handler";
import { buildSnapshot } from "../lib/autopilot-proxy";

const NOW = new Date("2026-10-16T00:00:00Z");
const snapshot = buildSnapshot(
  [
    ...Array.from({ length: 40 }, () => ({ roleFamily: "software-engineer-backend", skills: ["go", "sql"] })),
    ...Array.from({ length: 8 }, () => ({ roleFamily: "design", skills: ["figma"] })),
  ],
  NOW,
);

function make(over: Partial<AutopilotDeps> = {}) {
  const deps: AutopilotDeps = {
    snapshot: vi.fn(async () => snapshot),
    limit: vi.fn(async () => ({ allowed: true, limit: 60, remaining: 59, retryAfter: 0, resetAt: NOW })),
    hops: () => 0,
    ...over,
  };
  const GET = createAutopilotHandler(deps);
  return { deps, get: (qs = "") => GET(new Request(`http://t.test/api/public/stats/autopilot${qs}`)) };
}

describe("GET /api/public/stats/autopilot", () => {
  it("returns perWeek and asOf, labelled as an estimate with the method spelled out", async () => {
    const res = await make().get("?min=50&role=design");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.perWeek).toBe(2);
    expect(body.asOf).toBe(NOW.toISOString());
    expect(body.min).toBe(50);
    expect(body.role).toBe("design");
    expect(body.estimate.label).toBe("estimate");
    expect(body.estimate.method).toMatch(/not a match against your resume/);
    expect(body.estimate.windowDays).toBe(28);
  });

  it("defaults to min 70 across all roles", async () => {
    const body = await (await make().get()).json();
    expect(body.min).toBe(70);
    expect(body.role).toBeNull();
    expect(body.perWeek).toBe(12);
  });

  it("is cached for 300 s with an ETag, answers 304 to a matching If-None-Match, and allows any origin", async () => {
    const { get } = make();
    const res = await get("?min=10");
    expect(res.headers.get("cache-control")).toContain("s-maxage=300");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const etag = res.headers.get("etag")!;
    const GET = createAutopilotHandler({ snapshot: async () => snapshot, limit: async () => ({ allowed: true, limit: 60, remaining: 1, retryAfter: 0, resetAt: NOW }), hops: () => 0 });
    const again = await GET(new Request("http://t.test/x?min=10", { headers: { "if-none-match": etag } }));
    expect(again.status).toBe(304);
  });

  it.each([
    ["?min=101", "min"],
    ["?min=-1", "min"],
    ["?min=abc", "min"],
    ["?min=7.5", "min"],
    ["?min=", "min"],
    ["?min=1e2", "min"],
    ["?role=astronaut", "role"],
    ["?role=Design", "role"],
    ["?min=1&min=2", "min"],
    ["?foo=bar", "foo"],
  ])("rejects %s with 400 invalid_param naming %s", async (qs, param) => {
    const { get, deps } = make();
    const res = await get(qs);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_param");
    expect(body.error.param).toBe(param);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(deps.snapshot).not.toHaveBeenCalled();
  });

  it("accepts the boundaries 0 and 100", async () => {
    const { get } = make();
    expect((await get("?min=0")).status).toBe(200);
    expect((await get("?min=100")).status).toBe(200);
  });

  it("returns 429 with Retry-After before touching data", async () => {
    const { get, deps } = make({ limit: async () => ({ allowed: false, limit: 60, remaining: 0, retryAfter: 17, resetAt: NOW }) });
    const res = await get("?min=5");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
    expect(deps.snapshot).not.toHaveBeenCalled();
  });

  it("fails open when the limiter is down", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await make({ limit: () => Promise.reject(new Error("rate_limits missing")) }).get("?min=5");
    expect(res.status).toBe(200);
    spy.mockRestore();
  });

  it("hides internal errors behind a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await make({ snapshot: () => Promise.reject(new Error("db password is hunter2")) }).get("?min=5");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
    spy.mockRestore();
  });
});
