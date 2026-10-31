import { describe, expect, it, vi } from "vitest";
import { resolveScreen, type ScreenEnv } from "@/lib/adapters/screen";

class Redirect extends Error {}
class NotFound extends Error {}

function env(over: Partial<ScreenEnv<string>> = {}): ScreenEnv<string> & { log: ReturnType<typeof vi.fn> } {
  return {
    dev: false,
    accountsOn: async () => true,
    ctx: async () => "ctx",
    redirect: (to) => {
      throw new Redirect(to);
    },
    notFound: () => {
      throw new NotFound();
    },
    log: vi.fn(),
    ...over,
  } as ScreenEnv<string> & { log: ReturnType<typeof vi.fn> };
}
const data = { data: { n: 1 }, empty: false };

describe("resolveScreen", () => {
  it("signed in with data reads real data", async () => {
    const read = vi.fn(async (c: string) => ({ ...data, data: { n: c.length } }));
    expect(await resolveScreen(env(), { read })).toEqual({ source: "real", data: { n: 3 } });
    expect(await resolveScreen(env({ dev: true }), { read })).toEqual({ source: "real", data: { n: 3 } });
  });
  it("flag off: sample in dev, 404 in production, and never reads", async () => {
    const read = vi.fn(async () => data);
    expect(await resolveScreen(env({ dev: true, accountsOn: async () => false }), { read })).toEqual({ source: "sample" });
    await expect(resolveScreen(env({ accountsOn: async () => false }), { read })).rejects.toBeInstanceOf(NotFound);
    expect(read).not.toHaveBeenCalled();
  });
  it("signed out: sample in dev, /signin in production", async () => {
    const read = vi.fn(async () => data);
    expect(await resolveScreen(env({ dev: true, ctx: async () => null }), { read })).toEqual({ source: "sample" });
    await expect(resolveScreen(env({ ctx: async () => null }), { read })).rejects.toThrow(Redirect);
    expect(read).not.toHaveBeenCalled();
  });
  it("no data: sample in dev only; production shows the real empty screen", async () => {
    const read = async () => ({ data: { n: 0 }, empty: true });
    expect(await resolveScreen(env({ dev: true }), { read })).toEqual({ source: "sample" });
    expect(await resolveScreen(env(), { read })).toEqual({ source: "real", data: { n: 0 } });
  });
  it("forbidden (a student opening the console): 404 in production, sample in dev", async () => {
    const read = async () => ({ data: null as never, empty: true, forbidden: true });
    await expect(resolveScreen(env(), { read })).rejects.toBeInstanceOf(NotFound);
    expect(await resolveScreen(env({ dev: true }), { read })).toEqual({ source: "sample" });
  });
  it("a failed read falls back to the sample in dev only", async () => {
    const read = async () => {
      throw new Error("db down");
    };
    const dev = env({ dev: true });
    expect(await resolveScreen(dev, { read })).toEqual({ source: "sample" });
    expect(dev.log).toHaveBeenCalledOnce();
    expect(String(dev.log.mock.calls[0]![0])).not.toContain("db down");
    await expect(resolveScreen(env(), { read })).rejects.toThrow("db down");
  });
  it("prodReady false: production 404s without touching anything, dev reads real data", async () => {
    const read = vi.fn(async () => data);
    const accountsOn = vi.fn(async () => true);
    await expect(resolveScreen(env({ accountsOn }), { read, prodReady: false })).rejects.toBeInstanceOf(NotFound);
    expect(accountsOn).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(await resolveScreen(env({ dev: true }), { read, prodReady: false })).toEqual({ source: "real", data: { n: 1 } });
  });
});

describe("samples are for development only", async () => {
  const { isDevEnv } = await import("@/lib/adapters/screen");
  it("NODE_ENV unset, test, staging or production is not development; development or HIRELANE_SAMPLES=1 is", () => {
    expect(isDevEnv({})).toBe(false);
    for (const v of ["test", "production", "staging", "preview"]) expect(isDevEnv({ NODE_ENV: v }), v).toBe(false);
    expect(isDevEnv({ NODE_ENV: "development" })).toBe(true);
    expect(isDevEnv({ NODE_ENV: "test", HIRELANE_SAMPLES: "1" })).toBe(true);
    expect(isDevEnv({ NODE_ENV: "production", HIRELANE_SAMPLES: "yes" })).toBe(false);
  });
});
