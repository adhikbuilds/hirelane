import { describe, expect, it } from "vitest";
import config from "../next.config.mjs";

describe("next.config security headers", () => {
  it("sets nosniff, referrer policy and frame-ancestors none", async () => {
    const rules = await config.headers!();
    const all = rules.flatMap((r: { headers: { key: string; value: string }[] }) => r.headers);
    const get = (k: string) => all.find((h: { key: string; value: string }) => h.key === k)?.value;
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });
  it("hides the dev indicator", () => {
    expect(config.devIndicators).toBe(false);
  });
});
