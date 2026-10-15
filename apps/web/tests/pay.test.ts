import { describe, expect, it } from "vitest";
import { payOriginal } from "../lib/pay";

describe("payOriginal", () => {
  it("returns the Ashby tier summary as written", () => {
    expect(payOriginal({ compensation: { compensationTierSummary: "$120K - $160K" } })).toBe("$120K - $160K");
  });
  it("returns the Lever salary description as written", () => {
    expect(payOriginal({ salaryDescription: "Pay: 90,000 to 110,000 USD" })).toBe("Pay: 90,000 to 110,000 USD");
  });
  it("builds a Lever range from structured fields", () => {
    expect(payOriginal({ salaryRange: { min: 90000, max: 110000, currency: "USD", interval: "per-year-salary" } })).toBe(
      "90,000 to 110,000 USD per-year-salary",
    );
  });
  it("builds a Greenhouse range from cents", () => {
    expect(payOriginal({ pay_input_ranges: [{ min_cents: 10000000, max_cents: 15000000, currency_type: "USD" }] })).toBe(
      "100,000 to 150,000 USD",
    );
  });
  it("is null when the board states no pay", () => {
    expect(payOriginal({})).toBeNull();
    expect(payOriginal(null)).toBeNull();
    expect(payOriginal("text")).toBeNull();
    expect(payOriginal({ compensation: { compensationTierSummary: "  " } })).toBeNull();
  });
  it("strips markup from an HTML-only salary description", () => {
    const raw = { salaryDescription: '<div><span data-teams="true">Pay range is based on OTE</span></div>' };
    expect(payOriginal(raw)).toBe("Pay range is based on OTE");
  });
  it("prefers the plain-text salary description when both exist", () => {
    expect(payOriginal({ salaryDescription: "<b>x</b>", salaryDescriptionPlain: "USD 100k" })).toBe("USD 100k");
  });
});
