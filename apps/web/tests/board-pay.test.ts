import { describe, expect, it } from "vitest";
import { payColumn } from "../components/board/pay";

const base = {
  min: 1_800_000_00, max: 2_500_000_00, currency: "INR", period: "year" as const, kind: "base" as const, display: "₹18–25 L/yr",
  annualUsd: { min: 21_000_00, max: 29_000_00 }, annualInr: { min: 1_800_000_00, max: 2_500_000_00 }, source: "text" as const, fxDate: "2026-10-01",
};

describe("payColumn", () => {
  it("is null when pay is not stated", () => {
    expect(payColumn(null, "USD")).toBeNull();
  });
  it("shows the normalised annual figure with the original beneath when they differ", () => {
    const p = payColumn({ ...base, display: "₹1.5–2.1 L/mo", period: "month", min: 150_000_00, max: 210_000_00 }, "INR");
    expect(p?.main).toBe("₹18–25 L/yr");
    expect(p?.original).toBe("₹1.5–2.1 L/mo");
  });
  it("omits the original when it is already the normalised figure", () => {
    const p = payColumn(base, "INR");
    expect(p?.main).toBe("₹18–25 L/yr");
    expect(p?.original).toBeNull();
  });
  it("normalises to USD by default", () => {
    const p = payColumn(base, "USD");
    expect(p?.main).toBe("$21–29K/yr");
    expect(p?.original).toBe("₹18–25 L/yr");
  });
  it("falls back to the original when no annual equivalent exists", () => {
    const p = payColumn({ ...base, annualUsd: null }, "USD");
    expect(p?.main).toBe("₹18–25 L/yr");
    expect(p?.original).toBeNull();
  });
});
