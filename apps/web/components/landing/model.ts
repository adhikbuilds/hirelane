/** Pure model for the landing and content pages. No I/O, so every rule is unit-tested. */

const MIN = 60_000;

/** "2h 14m", "45m", "3d 5h". Future dates clamp to "0m". */
export function formatAgeLong(from: Date, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - from.getTime()) / MIN));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    const m = mins % 60;
    return m === 0 ? `${hours}h` : `${hours}h ${m}m`;
  }
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}

export function ledgerCaption(refreshedAt: Date | null, boards: number, now: Date = new Date()): string {
  if (!refreshedAt) return "no completed ingest run yet";
  return `refreshed ${formatAgeLong(refreshedAt, now)} ago from ${boards} ${boards === 1 ? "board" : "boards"}`;
}

export type Freshness = "fresh" | "late" | "stale" | "none";

/** Ingest runs every 6 hours: up to 8h is on schedule, up to 24h is late, beyond that is stale. */
export function freshnessState(finishedAt: Date | null, now: Date = new Date()): Freshness {
  if (!finishedAt) return "none";
  const hours = (now.getTime() - finishedAt.getTime()) / (60 * MIN);
  if (hours <= 8) return "fresh";
  if (hours <= 24) return "late";
  return "stale";
}

export function statusSummary(state: Freshness, boardsOk: number, boardsFailed: number): string {
  if (state === "none") return "No ingest run has completed yet.";
  if (boardsFailed === 0) return `All ${boardsOk} boards fetched on the last run.`;
  return `${boardsOk} boards fetched, ${boardsFailed} failed on the last run.`;
}

export const UNDO_MS = 4000;

export type PreviewField = {
  label: string;
  value: string;
  /** Where the draft came from, or why it needs the user. */
  source: string;
  needsYou: boolean;
  reason: string;
};

/** Fixture for the landing preview. Invented person and role; not real data. */
export const PREVIEW = {
  role: "Data engineer",
  company: "Example Freight Systems",
  resume: "Resume v3, data engineering",
  fields: [
    {
      label: "Why this role",
      value:
        "I have spent four years building batch and streaming pipelines on Postgres and Kafka, which is the stack this team runs.",
      source: "Drafted from your resume, work history",
      needsYou: false,
      reason: "",
    },
    {
      label: "Notice period",
      value: "30 days",
      source: "From your saved answers",
      needsYou: false,
      reason: "",
    },
    {
      label: "Are you authorised to work in Germany?",
      value: "",
      source: "",
      needsYou: true,
      reason: "Your profile has no work authorisation for Germany. Hirelane does not guess this one.",
    },
  ] satisfies PreviewField[],
} as const;

export const PRICING = {
  free: { applications: 10 },
  weekly: {
    currency: "INR",
    availability: "Weekly plans, priced in INR, arrive in Phase 7.",
  },
} as const;
