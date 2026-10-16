import { describe, expect, it, vi } from "vitest";
import { freshness, logoPathOf, toBoardRow } from "../components/board/row-model";
import { suggestItems, traceGroup, traceSummary } from "../components/board/preview-model";
import { pageHref } from "../components/board/job-board";
import { PREVIEW_MAX_SLUGS, previewTrace, queryPreviews, suggestBoard, type PublicJob } from "../lib/queries/jobs";

vi.mock("../app/jobs/actions", () => ({ loadMoreJobs: vi.fn(), loadJobPreview: vi.fn(), suggestJobs: vi.fn() }));

const NOW = new Date("2026-10-16T12:00:00Z");
const job = (over: Partial<PublicJob> = {}): PublicJob => ({
  slug: "data-engineer-1",
  url: "http://x/job/data-engineer-1",
  markdownUrl: "http://x/job/data-engineer-1.md",
  title: "Data engineer",
  company: { slug: "acme", name: "Acme Labs", logoUrl: "http://localhost:3001/logos/acme.png" },
  roleFamily: "data-engineer",
  level: "mid",
  workplace: "hybrid",
  employment: "fulltime",
  remote: false,
  remoteScope: "none",
  countries: ["IN"],
  locations: ["Bengaluru, India"],
  visa: "unknown",
  salary: {
    min: 1800000, max: 2500000, currency: "INR", period: "year", kind: "base", display: "₹18–25 L/yr",
    annualUsd: { min: 2000000, max: 2800000 }, annualInr: { min: 1800000, max: 2500000 }, source: "text", fxDate: "2026-10-01",
  },
  skills: [1, 2, 3, 4, 5].map((i) => ({ id: `s${i}`, label: `Skill ${i}` })),
  postedAt: null,
  firstSeenAt: "2026-10-16T10:00:00Z",
  lastSeenAt: "2026-10-16T10:00:00Z",
  freshAt: "2026-10-16T10:00:00Z",
  ats: "greenhouse",
  fixture: false,
  ...over,
});

describe("freshness", () => {
  it("buckets by age with exact boundaries", () => {
    expect(freshness("2026-10-16T11:59:00Z", NOW)).toBe("new");
    expect(freshness("2026-10-15T12:00:01Z", NOW)).toBe("new");
    expect(freshness("2026-10-15T12:00:00Z", NOW)).toBe("week");
    expect(freshness("2026-10-09T12:00:01Z", NOW)).toBe("week");
    expect(freshness("2026-10-09T12:00:00Z", NOW)).toBe("old");
  });
});

describe("logoPathOf", () => {
  it("keeps only the same-origin path", () => {
    expect(logoPathOf("http://localhost:3001/logos/a.png")).toBe("/logos/a.png");
    expect(logoPathOf("/logos/a.png")).toBe("/logos/a.png");
    expect(logoPathOf(null)).toBeNull();
    expect(logoPathOf("not a url")).toBeNull();
  });
});

describe("toBoardRow", () => {
  it("maps a job to the compact row: at most 3 skills, place and workplace chips, pay in the viewer's currency", () => {
    const r = toBoardRow(job(), "INR", NOW);
    expect(r.skills).toEqual(["Skill 1", "Skill 2", "Skill 3"]);
    expect(r.chips).toEqual(["IN", "Hybrid"]);
    expect(r.pay).toBeTruthy();
    expect(r.age).toBe("2h");
    expect(r.fresh).toBe("new");
    expect(r.company.logoPath).toBe("/logos/acme.png");
    expect(r.ats).toBe("greenhouse");
  });
  it("is honest when there is no pay, no place and no skills", () => {
    const r = toBoardRow(job({ salary: null, countries: [], locations: [], workplace: null, skills: [] }), "USD", NOW);
    expect(r.pay).toBeNull();
    expect(r.payNote).toBeNull();
    expect(r.chips).toEqual([]);
    expect(r.skills).toEqual([]);
  });
  it("counts extra countries", () => {
    expect(toBoardRow(job({ countries: ["IN", "US", "GB", "DE"] }), "USD", NOW).chips[0]).toBe("IN, US, GB +1");
  });
});

describe("traceSummary", () => {
  const trace = [
    { label: "Found 18-25 L", ruleId: "salary.range.dash" },
    { label: "Read 18 as lakh", ruleId: "salary.num.lakh" },
    { label: "Currency INR", ruleId: "salary.currency.symbol" },
    { label: "Per year", ruleId: "salary.period.explicit" },
    { label: "Converted at 88", ruleId: "salary.fx.rate" },
    { label: "Min <= max", ruleId: "salary.check.order" },
  ];
  it("groups rule ids", () => {
    expect(traceGroup("salary.fx.rate")).toBe("FX");
    expect(traceGroup("salary.kind.ctc")).toBe("Read");
    expect(traceGroup("anything.else")).toBe("Check");
  });
  it("takes the first step of each group, capped, and reports the full count", () => {
    const s = traceSummary(trace, 4);
    expect(s.steps.map((x) => x.group)).toEqual(["Read", "Currency", "Period", "FX"]);
    expect(s.steps[0]!.label).toBe("Found 18-25 L");
    expect(s.total).toBe(6);
  });
  it("handles an empty trace", () => {
    expect(traceSummary([])).toEqual({ steps: [], total: 0 });
  });
});

describe("previewTrace", () => {
  it("accepts {steps} and a bare array, and drops malformed steps", () => {
    const ok = { label: "a", ruleId: "salary.num.x" };
    expect(previewTrace({ steps: [ok, null, { label: 1 }, "x"] })).toEqual([ok]);
    expect(previewTrace([ok])).toEqual([ok]);
    expect(previewTrace(null)).toEqual([]);
    expect(previewTrace("nope")).toEqual([]);
    expect(previewTrace({ steps: "nope" })).toEqual([]);
  });
});

describe("queryPreviews", () => {
  it("validates and de-duplicates slugs, and keeps only http(s) apply links", async () => {
    const query = vi.fn(async () => ({
      rows: [
        { slug: "a-1", salary_trace: { steps: [{ label: "x", ruleId: "salary.num.a" }] }, apply_url: "https://boards.greenhouse.io/acme/jobs/1", req_total: 6, reqs: [{ kind: "must", text: "SQL", category: "skill", yearsMin: 3 }] },
        { slug: "b-2", salary_trace: null, apply_url: "javascript:alert(1)", req_total: 0, reqs: [] },
      ],
    }));
    const out = await queryPreviews({ query }, ["a-1", "a-1", "b-2", "BAD SLUG", "../x"]);
    expect(query).toHaveBeenCalledTimes(1);
    expect((query.mock.calls[0] as unknown[])[1]).toEqual([["a-1", "b-2"]]);
    expect(out["a-1"]).toMatchObject({ applyUrl: "https://boards.greenhouse.io/acme/jobs/1", requirementsTotal: 6, trace: [{ ruleId: "salary.num.a" }] });
    expect(out["b-2"]!.applyUrl).toBeNull();
    expect(out["b-2"]!.trace).toEqual([]);
  });
  it("does not touch the database for no valid slugs, and caps the batch", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(await queryPreviews({ query }, ["", "NOPE"])).toEqual({});
    expect(query).not.toHaveBeenCalled();
    const many = Array.from({ length: PREVIEW_MAX_SLUGS + 20 }, (_, i) => `s-${i}`);
    await queryPreviews({ query }, many);
    expect(((query.mock.calls[0] as unknown[])[1] as string[][])[0]).toHaveLength(PREVIEW_MAX_SLUGS);
  });
});

describe("suggestBoard", () => {
  it("returns nothing under two characters without querying", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(await suggestBoard({ query }, " a ")).toEqual({ companies: [], titles: [] });
    expect(await suggestBoard({ query }, "")).toEqual({ companies: [], titles: [] });
    expect(query).not.toHaveBeenCalled();
  });
  it("binds user text as an escaped literal and maps rows", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("FROM companies")
        ? { rows: [{ slug: "acme", name: "Acme 100%", logo_path: "/logos/a.png", open: "7" }, { slug: "x", name: "X", logo_path: "//evil", open: 1 }] }
        : { rows: [{ title: "Data engineer", n: "12" }] },
    );
    const out = await suggestBoard({ query }, "  100%_ ");
    const args = (query.mock.calls[0] as unknown[])[1] as string[];
    expect(args).toEqual(["%100\\%\\_%", "100\\%\\_%"]);
    expect(out.companies).toEqual([
      { slug: "acme", name: "Acme 100%", logoPath: "/logos/a.png", open: 7 },
      { slug: "x", name: "X", logoPath: null, open: 1 },
    ]);
    expect(out.titles).toEqual([{ title: "Data engineer", n: 12 }]);
  });
  it("cuts very long input", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await suggestBoard({ query }, "x".repeat(500));
    expect(((query.mock.calls[0] as unknown[])[1] as string[])[1]).toHaveLength(61);
  });
});

describe("suggestItems", () => {
  it("lists companies first, then titles, with links", () => {
    const items = suggestItems(
      { companies: [{ slug: "acme", name: "Acme", logoPath: null, open: 1200 }], titles: [{ title: "Data engineer", n: 1 }] },
      (t) => `/jobs?q=${encodeURIComponent(t)}`,
    );
    expect(items.map((i) => [i.type, i.href, i.meta])).toEqual([
      ["company", "/company/acme", "1,200 open"],
      ["title", "/jobs?q=Data%20engineer", "1 role"],
    ]);
  });
});

describe("pageHref", () => {
  it("writes filters, then page, then sort", () => {
    expect(pageHref("remote=1&sort=pay", 3)).toBe("/jobs?remote=1&page=3&sort=pay");
    expect(pageHref("q=data", 1)).toBe("/jobs?q=data");
    expect(pageHref("", 1)).toBe("/jobs");
    expect(pageHref("page=9&remote=1", 2)).toBe("/jobs?remote=1&page=2");
  });
});
