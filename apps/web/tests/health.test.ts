import { describe, expect, it } from "vitest";
import { GET } from "../app/api/health/route";

describe("/api/health", () => {
  it("returns {ok:true} uncached", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
