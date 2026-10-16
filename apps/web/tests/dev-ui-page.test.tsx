import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/dev/ui/gallery", () => ({ Gallery: () => null }));

describe("/dev/ui", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is a 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { default: Page } = await import("../app/dev/ui/page");
    expect(() => Page()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });
});
