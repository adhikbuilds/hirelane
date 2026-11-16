import { describe, expect, it } from "vitest";
import nextConfig from "../next.config.mjs";
import { buildCsp, buildSecurityHeaders, HSTS_VALUE } from "../security-headers.mjs";

const val = (hs: { key: string; value: string }[], k: string) => hs.find((h) => h.key === k)?.value;

describe("security headers (SEC-8)", () => {
  const prod = buildSecurityHeaders({ NODE_ENV: "production" });
  const dev = buildSecurityHeaders({ NODE_ENV: "development" });

  it("sends HSTS in production only", () => {
    expect(val(prod, "Strict-Transport-Security")).toBe(HSTS_VALUE);
    expect(HSTS_VALUE).toMatch(/max-age=\d{8,}/);
    expect(val(dev, "Strict-Transport-Security")).toBeUndefined();
  });

  it("CSP carries the framing, plugin and base restrictions in every mode", () => {
    for (const hs of [prod, dev]) {
      const csp = val(hs, "Content-Security-Policy")!;
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("default-src 'self'");
    }
  });

  it("never allows eval or a websocket in production", () => {
    const csp = buildCsp({ NODE_ENV: "production" });
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws://");
    expect(buildCsp({ NODE_ENV: "development" })).toContain("'unsafe-eval'");
  });

  it("keeps the other baseline headers", () => {
    expect(val(prod, "X-Content-Type-Options")).toBe("nosniff");
    expect(val(prod, "X-Frame-Options")).toBe("DENY");
    expect(val(prod, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(val(prod, "Permissions-Policy")).toContain("camera=()");
  });

  it("next.config applies the headers to every path", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!;
    expect(all.headers.map((h) => h.key)).toContain("Content-Security-Policy");
    expect(rules.find((r) => r.source === "/job/:slug")?.headers[0]).toEqual({ key: "Vary", value: "Accept" });
  });
});
