import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ broken: false, allowed: true }));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.9" }) }));
vi.mock("@hirelane/db", () => ({
  withAdmin: async (fn: (c: unknown) => unknown) => {
    if (state.broken) throw new Error("connection refused");
    return fn({
      query: async () => ({ rows: [{ count: state.allowed ? 1 : 10_000 }] }),
    });
  },
}));
vi.mock("@/lib/queries/jobs", () => ({
  SUGGEST_MAX: 60,
  searchJobs: vi.fn(async () => ({ total: 0, jobs: [] })),
  previewsFor: vi.fn(async () => ({})),
  suggestBoard: vi.fn(async () => ({ companies: [], titles: [] })),
}));

import { loadJobPreview, loadMoreJobs, suggestJobs } from "../app/jobs/actions";

beforeEach(() => {
  state.broken = false;
  state.allowed = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("board actions when the limiter is down (SEC-5)", () => {
  it("loadMoreJobs reports busy instead of an empty, final page", async () => {
    state.broken = true;
    expect(await loadMoreJobs("", 2)).toEqual({ rows: [], page: 1, hasMore: false, busy: true });
  });

  it("suggestJobs reports busy", async () => {
    state.broken = true;
    expect(await suggestJobs("stripe")).toMatchObject({ busy: true, companies: [], titles: [] });
  });

  it("loadJobPreview throws so the client retries rather than caching 'unknown job'", async () => {
    state.broken = true;
    await expect(loadJobPreview("some-slug")).rejects.toThrow("board_busy");
  });

  it("an over-budget caller is limited, not busy", async () => {
    state.allowed = false;
    const res = await loadMoreJobs("", 2);
    expect(res.busy).toBeUndefined();
    expect(res.rows).toEqual([]);
    expect(await loadJobPreview("some-slug")).toBeNull();
  });

  it("a healthy limiter lets the call through", async () => {
    const res = await loadMoreJobs("", 2);
    expect(res.busy).toBeUndefined();
  });
});
