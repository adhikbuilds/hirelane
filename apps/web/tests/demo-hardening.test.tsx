import { afterEach, describe, expect, it, vi } from "vitest";
import { robotsTxt } from "../lib/robots";

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;

describe("robots and the sample pages", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("robots.txt disallows /dev/ so sample pages are not indexed on a public host", () => {
    expect(robotsTxt("https://example.test").split("\n")).toContain("Disallow: /dev/");
  });

  it("every /dev page is noindex by layout metadata", async () => {
    const { metadata } = await import("../app/dev/layout");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("the /v3 landing (drag-to-pass stack) is a 404 in production and open in development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HIRELANE_SAMPLES", "");
    const { default: Layout } = await import("../app/v3/layout");
    expect(() => Layout({ children: null })).toThrow(NOT_FOUND);
    vi.stubEnv("NODE_ENV", "development");
    expect(() => Layout({ children: null })).not.toThrow();
  });
});
