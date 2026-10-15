import { describe, expect, it } from "vitest";
import { robotsTxt } from "../lib/robots";

describe("robotsTxt", () => {
  const body = robotsTxt("https://hirelane.test/");
  it("points at the sitemap index with an absolute URL", () => {
    expect(body).toContain("Sitemap: https://hirelane.test/sitemap.xml");
  });
  it("keeps the public API crawlable while closing the rest of /api and ops", () => {
    expect(body).toMatch(/Allow: \/api\/public\//);
    expect(body).toMatch(/Disallow: \/api\//);
    expect(body).toMatch(/Disallow: \/ops\//);
    expect(body).toMatch(/Disallow: \/md\//);
  });
  it("closes the app areas named in PLAN 7.1", () => {
    expect(body).toMatch(/Disallow: \/applications\n/);
    expect(body).toMatch(/Disallow: \/triage\n/);
  });
});
