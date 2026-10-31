import { describe, expect, it } from "vitest";
import type { Cohort } from "@hirelane/services";
import { campusIsEmpty, describeCriterion, metricTotal, toCampusOverview, toOfferRows, toProgrammeRows, type CampusInput, type Cell, type DriveRow, type OutcomeRow } from "@/lib/adapters/campus";

const cohort = (id: string, o: Partial<Cohort> = {}): Cohort => ({ id, passoutYear: 2026, programme: "B.Com", rosterSize: 120, snapshotDay: "2026-10-29", joined: 80, joinedSuppressed: false, ...o });
const cells = (o: Record<string, number | null>): Cell[] => Object.entries(o).map(([metric, value]) => ({ metric, value, suppressed: value === null }));
const stats = (o: Record<string, number | null>, day: string | null = "2026-10-29") => ({ day, metrics: cells(o) });
const base: CampusInput = {
  campusName: "Sample University, Indore",
  cohorts: [cohort("c1")],
  stats: { c1: stats({ joined_verified: 80, stage_confirmed: 55, stage_no_resume: 15, stage_resume_unconfirmed: 10, blocker_active_backlog: 20, blocker_grad_below_60: null, blocker_secondary_below_60: 0, blocker_gap_year: 0, interview_reported: 15, offer_reported: 10, placed_on_roster: 30 }) },
  drives: [],
  counts: {},
};
const drive = (o: Partial<DriveRow> = {}): DriveRow => ({ id: "d1", cohortId: "c1", title: "Process Associate", link: "https://www.careers.example.test/job/1", status: "live", scamRisk: "none", criteria: [{ type: "min_score", pct: 55, throughout: true, levels: [], evidence: [] }, { type: "no_active_backlogs", evidence: [] }], publishedAt: "2026-10-29T00:00:00.000Z", ...o });

describe("metricTotal", () => {
  it("sums across cohorts only when every cell is visible", () => {
    const cs = [cohort("c1"), cohort("c2")];
    expect(metricTotal(cs, { c1: stats({ m: 12 }), c2: stats({ m: 15 }) }, "m")).toBe(27);
    expect(metricTotal(cs, { c1: stats({ m: 12 }), c2: stats({ m: null }) }, "m")).toBeNull();
    expect(metricTotal(cs, { c1: stats({ m: 12 }) }, "m")).toBeNull();
    expect(metricTotal([], {}, "m")).toBeNull();
  });
});

describe("toCampusOverview", () => {
  it("builds the overview from visible cells and never fills a hidden one", () => {
    const o = toCampusOverview(base);
    expect(o).toMatchObject({ sample: false, college: "Sample University, Indore", cohort: "B.Com, batch of 2026", asOf: "29 Oct", finalYears: 120, joined: 80, placedOnCampus: 30, offCampusOffers: { total: 10, verified: 0 } });
    expect(o.funnel).toEqual([
      { label: "Joined Hirelane", count: 80, action: "Invite the other 40" },
      { label: "Resume ready", count: 55, action: "Run a resume clinic" },
      { label: "Interview", count: 15, action: "Book a prep session" },
      { label: "Offer", count: 10, action: "Verify the offers in Outcomes" },
    ]);
    expect(o.stuck.map((s) => [s.blocker, s.students])).toEqual([
      ["Active backlogs", 20],
      ["Haven't added a resume yet", 15],
      ["Uploaded a resume but haven't confirmed it", 10],
    ]);
    expect(o.hiddenGroups).toBe(1); // blocker_grad_below_60 only
    expect(o.stuck.some((s) => s.blocker.includes("graduation"))).toBe(false);
  });
  it("drops a hidden funnel stage instead of showing zero", () => {
    const o = toCampusOverview({ ...base, stats: { c1: stats({ joined_verified: 80, stage_confirmed: null }) } });
    expect(o.funnel.map((f) => f.label)).toEqual(["Joined Hirelane"]);
    expect(o.funnel.some((f) => f.count === 0)).toBe(false);
    expect(o.hiddenGroups).toBeGreaterThan(0);
  });
  it("a cohort with no snapshot yet is an honest empty overview", () => {
    const o = toCampusOverview({ ...base, stats: { c1: { day: null, metrics: [] } } });
    expect(o.asOf).toBe("no snapshot yet");
    expect(o.funnel).toEqual([]);
    expect(o.stuck).toEqual([]);
  });
  it("no cohorts at all", () => {
    const o = toCampusOverview({ ...base, cohorts: [], stats: {} });
    expect(o).toMatchObject({ cohort: "No cohorts yet", finalYears: 0, joined: 0, funnel: [], hiddenGroups: 0 });
    expect(campusIsEmpty({ cohorts: [], drives: [] })).toBe(true);
    expect(campusIsEmpty({ cohorts: [cohort("c1")], drives: [] })).toBe(false);
  });
  it("labels several cohorts together", () => {
    const o = toCampusOverview({ ...base, cohorts: [cohort("c1"), cohort("c2", { programme: "BBA" })], stats: { c1: stats({ joined_verified: 40 }), c2: stats({ joined_verified: 30 }) } });
    expect(o.cohort).toBe("All programmes (2 cohorts)");
    expect(o.joined).toBe(70);
  });
  it("lists drives with counts from the snapshot and counts a hidden one", () => {
    const o = toCampusOverview({ ...base, drives: [drive(), drive({ id: "d2", status: "closed", link: null })], counts: { d1: stats({ drive_eligible: 45, drive_unknown: 15 }), d2: stats({ drive_eligible: null }) } });
    expect(o.drives[0]).toMatchObject({ company: "careers.example.test", role: "Process Associate", rules: "55% throughout, no active backlogs", eligible: 45, applied: 0, status: "open" });
    expect(o.drives[1]).toMatchObject({ company: "Pasted by you", eligible: 0, status: "closed", rules: "55% throughout, no active backlogs" });
    // a draft is not announced yet: it is not in the overview, and its missing count is not a hidden group
    const withDraft = toCampusOverview({ ...base, drives: [drive(), drive({ id: "d3", status: "draft" })], counts: { d1: stats({ drive_eligible: 45, drive_unknown: 15 }) } });
    expect(withDraft.drives).toHaveLength(1);
    expect(withDraft.hiddenGroups).toBe(o.hiddenGroups - 1);
    expect(o.hiddenGroups).toBe(2); // grad_below_60 + d2
  });
  it("copes with a malformed link and unreadable criteria", () => {
    const o = toCampusOverview({ ...base, drives: [drive({ link: "not a url", criteria: [{}, null] })], counts: {} });
    expect(o.drives[0]).toMatchObject({ company: "Pasted by you", rules: "No rules read from the notice" });
  });
  it("carries no student-level data", () => {
    expect(JSON.stringify(toCampusOverview(base))).not.toMatch(/email|studentName/);
  });
});

describe("describeCriterion", () => {
  it.each([
    [{ type: "min_score", pct: 60, cgpa: 6, throughout: false }, "60% or 6 CGPA"],
    [{ type: "passout_years", years: [2025, 2026] }, "2025 or 2026 passout"],
    [{ type: "degrees", list: ["B.Com", "BBA"] }, "B.Com, BBA"],
    [{ type: "max_gap_years", n: 1 }, "gap of at most 1 years"],
    [{ type: "max_backlog_history", n: 2 }, "at most 2 past backlogs"],
    [{ type: "mystery" }, ""],
  ])("%j", (c, want) => expect(describeCriterion(c)).toBe(want));
});

describe("toProgrammeRows", () => {
  it("one row per cohort; hidden joined means a hidden row with no numbers", () => {
    const cs = [cohort("c1"), cohort("c2", { programme: "BBA", rosterSize: 9 })];
    const rows = toProgrammeRows({ cohorts: cs, stats: { c1: stats({ joined_verified: 80, stage_confirmed: 55, interview_reported: null, offer_reported: 10 }), c2: stats({ joined_verified: null }) } });
    expect(rows[0]).toEqual({ programme: "B.Com (2026)", finalYears: 120, joined: 80, ready: 55, eligible: 0, applied: 0, interviews: 0, offers: 10 });
    expect(rows[1]).toEqual({ programme: "BBA (2026)", hidden: true, finalYears: 9 });
  });
  it("no cohorts, no rows", () => expect(toProgrammeRows({ cohorts: [], stats: {} })).toEqual([]));
});

describe("toOfferRows", () => {
  const out = (o: Partial<OutcomeRow>): OutcomeRow => ({ id: "o1", kind: "offer", employer: "Retail chain", roleTitle: null, packageLpa: 3.2, verification: "student_reported", studentName: "Sample Student 04", programme: "BBA", hasLetter: true, ...o });
  it("keeps offers only and maps verification", () => {
    const rows = toOfferRows([out({}), out({ id: "o2", kind: "interview" }), out({ id: "o3", verification: "tpo_verified", studentName: null, packageLpa: null, hasLetter: false })]);
    expect(rows.map((r) => r.id)).toEqual(["o1", "o3"]);
    expect(rows[0]).toMatchObject({ student: "Sample Student 04", lpa: 3.2, status: "waiting", letter: true, source: "Hirelane" });
    expect(rows[1]).toMatchObject({ status: "verified", lpa: 0, letter: false });
    expect(rows[1]!.student).not.toBe("");
  });
  it("empty in, empty out", () => expect(toOfferRows([])).toEqual([]));
});
