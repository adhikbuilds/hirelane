import { afterEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;

describe("app/dev/** gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("404s in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HIRELANE_SAMPLES", "");
    const { default: Layout } = await import("../app/dev/layout");
    expect(() => Layout({ children: null })).toThrow(NOT_FOUND);
  });

  it("404s in production when HIRELANE_SAMPLES is anything but 1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HIRELANE_SAMPLES", "0");
    const { default: Layout } = await import("../app/dev/layout");
    expect(() => Layout({ children: null })).toThrow(NOT_FOUND);
  });

  it("opens in production with HIRELANE_SAMPLES=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("HIRELANE_SAMPLES", "1");
    const { default: Layout } = await import("../app/dev/layout");
    expect(() => Layout({ children: null })).not.toThrow();
  });

  it("opens in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("HIRELANE_SAMPLES", "");
    const { default: Layout } = await import("../app/dev/layout");
    expect(() => Layout({ children: null })).not.toThrow();
  });
});
