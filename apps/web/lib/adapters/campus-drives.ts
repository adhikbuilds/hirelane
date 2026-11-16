import type { Cohort, DriveReach, InboxDrive } from "@hirelane/services";
import { dateLabel, daysBetween } from "./ist";

/** The console's drive inbox, shaped for a screen. Everything here comes from the drive services; nothing is invented. */
export interface ConsoleDrive {
  id: string;
  title: string;
  /** The employer's site, read from the link as text (never opened). */
  host: string | null;
  cohort: string;
  status: InboxDrive["status"];
  step: InboxDrive["step"];
  /** What staff do next, or null when nothing is waiting on them. */
  next: string | null;
  deadlineLabel: string | null;
  /** Whole India days to the deadline; null when there is none. Negative never appears: a past deadline is a closed drive. */
  daysLeft: number | null;
  closesTomorrow: boolean;
  rounds: string | null;
  documents: string | null;
  rules: string[];
  /** Staff only: the console shows these, no student route does. */
  scam: { risk: string; flags: { id: string; severity: string; quote: string }[] };
  reach: { state: DriveReach["state"]; qualify: number | null; couldntCheck: number | null; hidden: boolean; label: string };
}

export interface DriveInboxData {
  college: string;
  cohorts: { id: string; label: string }[];
  counts: { draft: number; live: number; closed: number };
  drives: ConsoleDrive[];
}

const NO_COHORT = "A cohort that is no longer listed";

const hostOf = (link: string | null): string | null => {
  try {
    return link ? new URL(link).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

const dayAsDate = (key: string): Date => new Date(`${key}T06:30:00Z`); // noon IST, safely inside the IST day

/**
 * The reach in words. A hidden figure (under 10, or hidden so it cannot be rebuilt by subtraction) is said to be hidden: it is
 * never printed as 0, never summed, and never worked out from the other one.
 */
export function reachLabel(r: DriveReach): string {
  if (r.state === "pending") return "Not counted yet. The count arrives with the next nightly update.";
  const parts: string[] = [];
  if (r.qualify !== null) parts.push(`About ${r.qualify} qualify.`);
  if (r.couldntCheck !== null) parts.push(`About ${r.couldntCheck} could not be checked yet.`);
  if (r.hidden) parts.push(r.qualify === null && r.couldntCheck === null ? "Both figures are hidden because the groups are too small to show." : "The other figure is hidden because the group is too small to show.");
  return parts.join(" ");
}

const NEXT: Record<InboxDrive["step"], string | null> = {
  counting: "Waiting for the first count",
  ready_to_publish: "Check the count, then publish",
  live: null,
  closed: null,
};

const rank = (d: ConsoleDrive): number => (d.status === "draft" ? 0 : d.status === "live" ? 1 : 2);

export function toDriveInbox(i: { campusName: string; cohorts: Cohort[]; drives: InboxDrive[]; now: Date }): DriveInboxData {
  const label = new Map(i.cohorts.map((c) => [c.id, `${c.programme}, batch of ${c.passoutYear}`]));
  const drives: ConsoleDrive[] = i.drives.map((d) => {
    // A closed drive has no countdown. A live one is never negative: a passed deadline makes it closed.
    const daysLeft = d.deadline && d.status !== "closed" ? Math.max(0, daysBetween(i.now, dayAsDate(d.deadline))) : null;
    return {
      id: d.id,
      title: d.title,
      host: hostOf(d.link),
      cohort: label.get(d.cohortId) ?? NO_COHORT,
      status: d.status,
      step: d.step,
      next: NEXT[d.step],
      deadlineLabel: d.deadline ? dateLabel(dayAsDate(d.deadline)) : null,
      daysLeft,
      closesTomorrow: d.status === "live" && daysLeft === 1,
      rounds: d.rounds,
      documents: d.documents,
      rules: d.rules,
      scam: { risk: d.scam.risk, flags: d.scam.flags.map((f) => ({ id: f.id, severity: f.severity, quote: f.quote })) },
      reach: { state: d.reach.state, qualify: d.reach.qualify, couldntCheck: d.reach.couldntCheck, hidden: d.reach.hidden, label: reachLabel(d.reach) },
    };
  });
  // Drafts need the TPO first; then live drives by soonest deadline (undated last); closed drives last, newest listing order kept.
  const order = new Map(drives.map((d, idx) => [d.id, idx]));
  drives.sort((a, b) => rank(a) - rank(b) || (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY) || order.get(a.id)! - order.get(b.id)!);
  return {
    college: i.campusName,
    cohorts: i.cohorts.map((c) => ({ id: c.id, label: label.get(c.id)! })),
    counts: { draft: drives.filter((d) => d.status === "draft").length, live: drives.filter((d) => d.status === "live").length, closed: drives.filter((d) => d.status === "closed").length },
    drives,
  };
}
