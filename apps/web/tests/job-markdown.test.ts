import { describe, expect, it } from "vitest";
import { renderJobMarkdown, type MarkdownJob } from "../lib/job-markdown";

const base: MarkdownJob = {
  id: "1",
  slug: "data-engineer-acme",
  title: "Data Engineer",
  companyName: "Acme Labs",
  companySlug: "acme",
  logoPath: null,
  workplace: "hybrid",
  employment: "fulltime",
  level: "mid",
  remoteScope: "none",
  countries: ["IN"],
  locations: ["Bengaluru, India"],
  visa: "unknown",
  salary: {
    minMinor: 1_800_000_00,
    maxMinor: 2_500_000_00,
    currency: "INR",
    period: "year",
    annualUsdMin: 2_000_00,
    annualUsdMax: 2_800_00,
    annualInrMin: 1_800_000_00,
    annualInrMax: 2_500_000_00,
    source: "text",
    kind: "base",
    fxDate: "2026-10-01",
    trace: { steps: [{ seq: 0, ruleId: "salary.currency.symbol", label: "Read ₹ as INR" }, { seq: 1, ruleId: "salary.period.year", label: "Stated per year" }] },
  },
  skills: [{ id: "python", label: "Python" }, { id: "sql", label: "SQL" }],
  requirements: [
    { kind: "must", text: "3+ years of SQL", category: "skill", yearsMin: 3, spanStart: 0, spanEnd: 5, section: null },
    { kind: "nice", text: "Airflow", category: "skill", yearsMin: null, spanStart: 0, spanEnd: 5, section: null },
  ],
  descriptionText: "plain",
  descriptionMd: "<p>Build <b>pipelines</b>.</p><script>alert(1)</script><h1>Perks</h1>",
  postedAt: new Date("2026-10-10T00:00:00Z"),
  firstSeenAt: new Date("2026-10-10T00:00:00Z"),
  lastSeenAt: new Date("2026-10-15T21:00:00Z"),
  closedAt: null,
  source: "live",
  applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
};
const opts = { origin: "https://hirelane.test", now: new Date("2026-10-16T00:00:00Z") };

describe("renderJobMarkdown", () => {
  const md = renderJobMarkdown(base, opts);

  it("opens with parseable front matter", () => {
    expect(md.startsWith("---\n")).toBe(true);
    const fm = md.slice(4, md.indexOf("\n---\n", 4));
    expect(fm).toContain('slug: "data-engineer-acme"');
    expect(fm).toContain('url: "https://hirelane.test/job/data-engineer-acme"');
    expect(fm).toContain('company: "Acme Labs"');
    expect(fm).toContain('countries: ["IN"]');
    expect(fm).toContain('workplace: "hybrid"');
    expect(fm).toContain('level: "mid"');
    expect(fm).toContain('employment: "fulltime"');
    expect(fm).toContain('visa: "unknown"');
    expect(fm).toMatch(/salary: "₹18–25 L\/yr"/);
    expect(fm).toContain('posted: "2026-10-10T00:00:00.000Z"');
    expect(fm).toContain('last_checked: "2026-10-15T21:00:00.000Z"');
    expect(fm).toContain('status: "open"');
    expect(fm).toContain('source: "live"');
  });

  it("has the title heading and the sections in order", () => {
    const order = ["# Data Engineer at Acme Labs", "## Pay", "## Requirements", "## Skills", "## Description", "## Apply"].map((h) => md.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("lists the pay trace as a numbered list", () => {
    expect(md).toContain("1. Read ₹ as INR\n2. Stated per year");
  });

  it("splits requirements into must and nice", () => {
    expect(md).toMatch(/Must have[\s\S]*- 3\+ years of SQL[\s\S]*Nice to have[\s\S]*- Airflow/);
  });

  it("sanitises the description and keeps its headings below the page heading", () => {
    expect(md).toContain("Build **pipelines**.");
    expect(md).not.toContain("alert(1)");
    expect(md).not.toMatch(/^# Perks/m);
    expect(md).toContain("### Perks");
  });

  it("states that Hirelane does not submit applications and links the employer form", () => {
    expect(md).toContain("https://boards.greenhouse.io/acme/jobs/1");
    expect(md).toMatch(/does not submit applications/i);
  });

  it("says when pay is not stated and never invents it", () => {
    const out = renderJobMarkdown({ ...base, salary: { ...base.salary, minMinor: null, maxMinor: null, trace: null } }, opts);
    expect(out).toContain("salary: null");
    expect(out).toContain("Not stated in the posting");
  });

  it("marks closed jobs and drops the apply link", () => {
    const out = renderJobMarkdown({ ...base, closedAt: new Date("2026-10-14T00:00:00Z") }, opts);
    expect(out).toContain('status: "closed 2026-10-14"');
    expect(out).not.toContain("boards.greenhouse.io");
  });

  it("drops unsafe apply URLs and escapes quotes and newlines in front matter", () => {
    const out = renderJobMarkdown({ ...base, applyUrl: "javascript:alert(1)", title: 'Dev "x"\nname', companyName: "A\nB: C" }, opts);
    expect(out).not.toContain("javascript:");
    const fm = out.slice(4, out.indexOf("\n---\n", 4));
    expect(fm.split("\n").every((l) => /^[a-z_]+: /.test(l))).toBe(true);
    expect(out).toContain('company: "A\\nB: C"');
  });

  it("handles empty optional data", () => {
    const out = renderJobMarkdown(
      { ...base, skills: [], requirements: [], descriptionMd: null, descriptionText: null, postedAt: null, countries: [], workplace: null, level: null, employment: null },
      opts,
    );
    expect(out).toContain("posted: null");
    expect(out).toContain("countries: []");
    expect(out).not.toContain("## Skills");
    expect(out).not.toContain("## Requirements");
    expect(out).not.toContain("## Description");
  });

  it("is deterministic", () => {
    expect(renderJobMarkdown(base, opts)).toBe(md);
  });

  it("shortens very long descriptions and points at the full page", () => {
    const out = renderJobMarkdown({ ...base, descriptionMd: `<p>${"word ".repeat(10_000)}</p>` }, opts);
    expect(out.length).toBeLessThan(14_000);
    expect(out).toContain("(Shortened. The full text is at https://hirelane.test/job/data-engineer-acme.)");
    const short = renderJobMarkdown(base, opts);
    expect(short).not.toContain("Shortened");
  });
});
