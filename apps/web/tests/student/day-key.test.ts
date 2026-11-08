// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSet, writeSet } from "@/lib/student/client";

describe("the skip day key is the IST day", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("at 20:00 UTC on the 29th it is already the 30th in India", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T20:00:00Z"));
    writeSet("skipped", new Set(["a"]));
    expect(localStorage.getItem("hl:skipped:2026-10-30")).toBe('["a"]');
    expect([...readSet("skipped")]).toEqual(["a"]);
  });

  it("at 18:00 UTC (23:30 IST) it is still the 29th", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-29T18:00:00Z"));
    writeSet("skipped", new Set(["a"]));
    expect(localStorage.getItem("hl:skipped:2026-10-29")).toBe('["a"]');
  });
});
