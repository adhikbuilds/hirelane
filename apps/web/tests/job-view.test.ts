import { describe, expect, it } from "vitest";
import {
  evidenceSlice,
  formatSalary,
  isJobSlug,
  monogram,
  safeHttpUrl,
  safeLogoSrc,
  traceRows,
} from "../lib/job-view";

describe("formatSalary", () => {
  it("writes INR in lakh", () => {
    expect(formatSalary({ minMinor: 180_000_000, maxMinor: 250_000_000, currency: "INR", period: "year" })).toBe(
      "₹18–25 L/yr",
    );
  });
  it("keeps up to two decimals in lakh and trims zeros", () => {
    expect(formatSalary({ minMinor: 1_250_000_00, maxMinor: 1_800_000_00, currency: "INR", period: "year" })).toBe(
      "₹12.5–18 L/yr",
    );
  });
  it("switches INR to crore at one crore", () => {
    expect(formatSalary({ minMinor: 100_000_000_0, maxMinor: 150_000_000_0, currency: "INR", period: "year" })).toBe(
      "₹1–1.5 Cr/yr",
    );
  });
  it("writes USD in thousands", () => {
    expect(formatSalary({ minMinor: 12_000_000, maxMinor: 16_000_000, currency: "USD", period: "year" })).toBe(
      "$120–160K/yr",
    );
  });
  it("writes small hourly amounts in full", () => {
    expect(formatSalary({ minMinor: 4500, maxMinor: 6000, currency: "USD", period: "hour" })).toBe("$45–60/hr");
  });
  it("handles one-sided and equal bounds", () => {
    expect(formatSalary({ minMinor: 12_000_000, maxMinor: null, currency: "USD", period: "year" })).toBe("$120K+/yr");
    expect(formatSalary({ minMinor: null, maxMinor: 12_000_000, currency: "USD", period: "year" })).toBe(
      "Up to $120K/yr",
    );
    expect(formatSalary({ minMinor: 12_000_000, maxMinor: 12_000_000, currency: "USD", period: "year" })).toBe(
      "$120K/yr",
    );
  });
  it("uses a code prefix for currencies without a short symbol and respects zero-decimal currencies", () => {
    expect(formatSalary({ minMinor: 60_000_00, maxMinor: 80_000_00, currency: "SEK", period: "month" })).toBe(
      "SEK 60–80K/mo",
    );
    expect(formatSalary({ minMinor: 8_000_000, maxMinor: 10_000_000, currency: "JPY", period: "year" })).toBe(
      "¥8–10M/yr",
    );
  });
  it("returns null with no figure or an unknown shape", () => {
    expect(formatSalary({ minMinor: null, maxMinor: null, currency: "USD", period: "year" })).toBeNull();
    expect(formatSalary({ minMinor: 100, maxMinor: 200, currency: null, period: "year" })).toBeNull();
  });
});

describe("traceRows", () => {
  const trace = {
    subject: "salary",
    outcome: "value",
    steps: [
      { seq: 0, ruleId: "salary.num.lpa", op: "parse", label: "Read 18-25 LPA", inputs: {}, output: null, evidence: [] },
      { seq: 1, ruleId: "salary.currency.symbol", op: "detect", label: "Currency INR", inputs: {}, output: "INR", evidence: [] },
      { seq: 2, ruleId: "salary.period.lpa_crore", op: "detect", label: "LPA means per year", inputs: {}, output: "year", evidence: [] },
      { seq: 3, ruleId: "salary.period.identity", op: "identity", label: "Already per year", inputs: {}, output: null, evidence: [] },
      { seq: 4, ruleId: "salary.fx.convert", op: "convert", label: "INR to USD at 0.0113", inputs: {}, output: null, evidence: [] },
      { seq: 5, ruleId: "salary.reject.years", op: "reject", label: "8+ is years", inputs: {}, output: null, evidence: [] },
    ],
  };
  it("groups steps by stage in order", () => {
    expect(traceRows(trace).map((r) => [r.group, r.label])).toEqual([
      ["Parse", "Read 18-25 LPA"],
      ["Currency", "Currency INR"],
      ["Period", "LPA means per year"],
      ["Period", "Already per year"],
      ["FX", "INR to USD at 0.0113"],
      ["Check", "8+ is years"],
    ]);
  });
  it("returns an empty list for anything that is not a trace", () => {
    expect(traceRows(null)).toEqual([]);
    expect(traceRows("x")).toEqual([]);
    expect(traceRows({ steps: "no" })).toEqual([]);
    expect(traceRows({ steps: [null, 3, { label: 5 }] })).toEqual([]);
  });
  it("drops malformed steps but keeps good ones", () => {
    const rows = traceRows({ steps: [{ ruleId: "salary.fx.convert", label: "ok" }, { ruleId: 1 }] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.group).toBe("FX");
  });
});

describe("evidenceSlice", () => {
  const text = "Intro. You have 5+ years of Go experience. Outro text here.";
  it("splits context around the span", () => {
    const start = text.indexOf("You");
    const end = text.indexOf(" Outro");
    const s = evidenceSlice(text, start, end, 7);
    expect(s?.quote).toBe("You have 5+ years of Go experience.");
    expect(s?.before).toBe("Intro. ");
    expect(s?.after).toBe(" Outro ");
  });
  it("rejects bad spans and missing text", () => {
    expect(evidenceSlice(null, 0, 3)).toBeNull();
    expect(evidenceSlice(text, 5, 5)).toBeNull();
    expect(evidenceSlice(text, -1, 5)).toBeNull();
    expect(evidenceSlice(text, 10, 9999)).toBeNull();
  });
});

describe("small helpers", () => {
  it("builds a two-letter monogram", () => {
    expect(monogram("OpenAI")).toBe("OP");
    expect(monogram("Scale AI")).toBe("SA");
    expect(monogram("  ")).toBe("?");
    expect(monogram("éclair")).toBe("ÉC");
  });
  it("only accepts same-origin logo paths", () => {
    expect(safeLogoSrc("/logos/a.png")).toBe("/logos/a.png");
    expect(safeLogoSrc("//evil.com/a.png")).toBeNull();
    expect(safeLogoSrc("https://evil.com/a.png")).toBeNull();
    expect(safeLogoSrc("/a/../b.png")).toBeNull();
    expect(safeLogoSrc(null)).toBeNull();
  });
  it("only accepts http(s) links", () => {
    expect(safeHttpUrl("https://jobs.example.com/1")).toBe("https://jobs.example.com/1");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
  it("validates slugs", () => {
    expect(isJobSlug("airbnb-lead-analytics-5b6164a4")).toBe(true);
    expect(isJobSlug("Bad Slug")).toBe(false);
    expect(isJobSlug("../etc")).toBe(false);
    expect(isJobSlug("")).toBe(false);
    expect(isJobSlug("a".repeat(201))).toBe(false);
  });
});
