import type { Cohort } from "@hirelane/services";
import type { CampusOverview, OfferRow, ProgrammeRow } from "@/lib/sample/campus";
import { shortDate } from "./ist";

/** The shapes the TPO services return, structurally (so tests need no database). */
export interface Cell {
  metric: string;
  value: number | null;
  suppressed: boolean;
}
export interface Stats {
  day: string | null;
  metrics: Cell[];
}
export interface DriveRow {
  id: string;
  cohortId: string;
  title: string;
  link: string | null;
  /** draft: not yet announced to students. The overview lists live and closed drives only. */
  status: "draft" | "live" | "closed";
  scamRisk: string;
  criteria: unknown[];
  publishedAt: string;
}
export interface OutcomeRow {
  id: string;
  kind: "interview" | "offer";
  employer: string;
  roleTitle: string | null;
  packageLpa: number | null;
  verification: "student_reported" | "tpo_verified";
  studentName: string | null;
  programme: string;
  hasLetter: boolean;
}

export interface CampusInput {
  campusName: string;
  cohorts: Cohort[];
  /** By cohort id. A cohort with no snapshot yet has day null and no metrics. */
  stats: Record<string, Stats | undefined>;
  drives: DriveRow[];
  /** By drive id. */
  counts: Record<string, Stats | undefined>;
}

/** A figure for a metric across the given cohorts, or null when any cohort's cell is hidden or missing. Hidden cells are never summed, estimated or derived. */
export function metricTotal(cohorts: Cohort[], stats: CampusInput["stats"], metric: string): number | null {
  if (cohorts.length === 0) return null;
  let sum = 0;
  for (const c of cohorts) {
    const cell = stats[c.id]?.metrics.find((m) => m.metric === metric);
    if (!cell || cell.suppressed || cell.value == null) return null;
    sum += cell.value;
  }
  return sum;
}

/** Cohort-level hidden count is "joined"; an unreadable field is false, not zero. */
export function campusIsEmpty(i: Pick<CampusInput, "cohorts" | "drives">): boolean {
  return i.cohorts.length === 0 && i.drives.length === 0;
}

const BLOCKERS: { metric: string; blocker: string; action: string }[] = [
  { metric: "stage_no_resume", blocker: "Haven't added a resume yet", action: "Remind them to upload one, or build it in Hirelane in a few minutes" },
  { metric: "stage_resume_unconfirmed", blocker: "Uploaded a resume but haven't confirmed it", action: "Ask them to check the details and press confirm; nothing is matched until they do" },
  { metric: "blocker_active_backlog", blocker: "Active backlogs", action: "Point them to drives with no backlog rule" },
  { metric: "blocker_grad_below_60", blocker: "Below 60% in graduation", action: "Point them to drives with a lower cutoff" },
  { metric: "blocker_secondary_below_60", blocker: "Below 60% in 12th or diploma", action: "Point them to drives with no 12th cutoff" },
  { metric: "blocker_gap_year", blocker: "A gap year on record", action: "Point them to drives with no gap rule" },
];

/** One short phrase for a parsed rule. */
export function describeCriterion(c: unknown): string {
  if (!c || typeof c !== "object") return "";
  const k = c as { type?: string; pct?: number; throughout?: boolean; cgpa?: number; years?: number[]; list?: string[]; n?: number };
  switch (k.type) {
    case "min_score":
      return `${k.pct}%${k.cgpa ? ` or ${k.cgpa} CGPA` : ""}${k.throughout ? " throughout" : ""}`;
    case "no_active_backlogs":
      return "no active backlogs";
    case "max_backlog_history":
      return `at most ${k.n} past backlogs`;
    case "passout_years":
      return `${(k.years ?? []).join(" or ")} passout`;
    case "degrees":
    case "branches":
      return (k.list ?? []).join(", ");
    case "max_gap_years":
      return `gap of at most ${k.n} years`;
    default:
      return "";
  }
}

const hostOf = (link: string | null): string | null => {
  try {
    return link ? new URL(link).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

/**
 * TPO services => the console overview. Rules:
 *  - a figure that is hidden (under 10, or complementary suppression) is dropped and counted in hiddenGroups; it is
 *    never shown as 0, summed with others or derived by subtraction;
 *  - funnel stages with no metric (eligible, applied) are left out rather than filled;
 *  - verified offers need the outcomes list, which logs every student it returns, so the overview does not read it: 0.
 */
export function toCampusOverview(i: CampusInput): CampusOverview {
  const total = (m: string) => metricTotal(i.cohorts, i.stats, m);
  let hidden = 0;
  const seen = (m: string): number | null => {
    const v = total(m);
    if (v === null && i.cohorts.length > 0) hidden += 1;
    return v;
  };

  const finalYears = i.cohorts.reduce((a, c) => a + c.rosterSize, 0);
  const joined = seen("joined_verified");
  const confirmed = seen("stage_confirmed");
  const interviews = seen("interview_reported");
  const offers = seen("offer_reported");
  const placed = seen("placed_on_roster");

  const funnel: CampusOverview["funnel"] = [];
  if (joined !== null) funnel.push({ label: "Joined Hirelane", count: joined, action: finalYears > joined ? `Invite the other ${finalYears - joined}` : "Everyone on your list has joined" });
  if (confirmed !== null) funnel.push({ label: "Resume ready", count: confirmed, action: "Run a resume clinic" });
  if (interviews !== null) funnel.push({ label: "Interview", count: interviews, action: "Book a prep session" });
  if (offers !== null) funnel.push({ label: "Offer", count: offers, action: "Verify the offers in Outcomes" });

  const stuck: CampusOverview["stuck"] = [];
  for (const b of BLOCKERS) {
    const n = seen(b.metric);
    if (n !== null && n > 0) stuck.push({ blocker: b.blocker, students: n, action: b.action });
  }
  stuck.sort((a, b) => b.students - a.students);

  const days = i.cohorts.map((c) => i.stats[c.id]?.day).filter((d): d is string => !!d).sort();
  const latest = days.at(-1);

  const drives: CampusOverview["drives"] = i.drives.filter((d) => d.status !== "draft").map((d) => {
    const cell = i.counts[d.id]?.metrics.find((m) => m.metric === "drive_eligible");
    if (!cell || cell.suppressed || cell.value == null) hidden += 1;
    const rules = d.criteria.map(describeCriterion).filter(Boolean).join(", ");
    return {
      company: hostOf(d.link) ?? "Pasted by you",
      role: d.title,
      rules: rules || "No rules read from the notice",
      eligible: cell && !cell.suppressed && cell.value != null ? cell.value : 0,
      applied: 0,
      deadline: "date not stored",
      status: d.status === "closed" ? "closed" : "open",
    };
  });

  return {
    sample: false,
    college: i.campusName,
    cohort: i.cohorts.length === 1 ? `${i.cohorts[0]!.programme}, batch of ${i.cohorts[0]!.passoutYear}` : i.cohorts.length === 0 ? "No cohorts yet" : `All programmes (${i.cohorts.length} cohorts)`,
    asOf: latest ? shortDate(new Date(`${latest}T06:30:00Z`)) : "no snapshot yet",
    finalYears,
    joined: joined ?? 0,
    placedOnCampus: placed ?? 0,
    offCampusOffers: { total: offers ?? 0, verified: 0 },
    funnel,
    stuck,
    hiddenGroups: hidden,
    drives,
  };
}

/** One row per cohort. A cohort whose joined count is hidden is a hidden row; any other hidden cell shows as 0, which the table prints as "under 10". */
export function toProgrammeRows(i: Pick<CampusInput, "cohorts" | "stats">): ProgrammeRow[] {
  return i.cohorts.map((c): ProgrammeRow => {
    const one = [c];
    const joined = metricTotal(one, i.stats, "joined_verified");
    if (joined === null) return { programme: `${c.programme} (${c.passoutYear})`, hidden: true, finalYears: c.rosterSize };
    const v = (m: string) => metricTotal(one, i.stats, m) ?? 0;
    return { programme: `${c.programme} (${c.passoutYear})`, finalYears: c.rosterSize, joined, ready: v("stage_confirmed"), eligible: 0, applied: 0, interviews: v("interview_reported"), offers: v("offer_reported") };
  });
}

/** Offers only (interviews are not placements). Every row is student-reported until the TPO verifies it. */
export function toOfferRows(rows: OutcomeRow[]): OfferRow[] {
  return rows
    .filter((r) => r.kind === "offer")
    .map((r) => ({
      id: r.id,
      student: r.studentName ?? "A student who chose not to share a name",
      programme: r.programme,
      employer: r.employer,
      lpa: r.packageLpa ?? 0,
      source: "Hirelane" as const,
      letter: r.hasLetter,
      status: r.verification === "tpo_verified" ? ("verified" as const) : ("waiting" as const),
    }));
}
