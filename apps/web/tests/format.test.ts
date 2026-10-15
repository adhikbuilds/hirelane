import { describe, expect, it } from "vitest";
import { formatAge, formatCount } from "../lib/format";

describe("formatAge", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  it("renders minutes, hours and days compactly", () => {
    expect(formatAge(new Date("2026-10-16T11:30:00Z"), now)).toBe("30m");
    expect(formatAge(new Date("2026-10-16T10:00:00Z"), now)).toBe("2h");
    expect(formatAge(new Date("2026-10-13T12:00:00Z"), now)).toBe("3d");
  });
  it("clamps future dates to 0m", () => {
    expect(formatAge(new Date("2026-10-16T13:00:00Z"), now)).toBe("0m");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(12345)).toBe("12,345");
  });
});
