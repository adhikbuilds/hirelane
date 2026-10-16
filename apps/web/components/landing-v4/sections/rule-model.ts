import { SAMPLE_ROLE } from "./board-model";

export { SAMPLE_ROLE };
export const DEFAULT_MIN = 70;
export const RULE_DEBOUNCE_MS = 300;
export const PER_DAY = [3, 5, 10] as const;
export const DEFAULT_PER_DAY = 5;

export type RuleJob = { slug: string; title: string; company: string; role: string; freshAt: string; score: number };

/** Role chips: Any, plus role families the API knows. Slugs are ROLE_FAMILIES members. */
export const RULE_ROLES: { value: string | null; label: string }[] = [
  { value: SAMPLE_ROLE, label: "Data engineer" },
  { value: "software-engineer-backend", label: "Backend" },
  { value: "data-scientist", label: "Data scientist" },
  { value: null, label: "Any role" },
];

/**
 * Only `min` and `role` are sent: the route is strict and rejects unknown parameters. The per-day cap is applied
 * on the client and never goes in the URL. `role` is omitted for "Any role".
 */
export function ruleUrl(min: number, role: string | null): string {
  const m = Math.min(100, Math.max(0, Math.round(Number.isFinite(min) ? min : DEFAULT_MIN)));
  const p = new URLSearchParams({ min: String(m) });
  if (role) p.set("role", role);
  return `/api/public/stats/autopilot?${p.toString()}`;
}

export function parsePerWeek(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const v = (body as { perWeek?: unknown }).perWeek;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** What the rule would draft in a week: the live estimate, capped by the per-day limit. */
export const cappedPerWeek = (perWeek: number, perDay: number): number => Math.min(perWeek, perDay * 7);

/** Jobs from the timeline pool that clear the rule (freshest first, as loaded). */
export function clearing(jobs: readonly RuleJob[], min: number, role: string | null): RuleJob[] {
  return jobs.filter((j) => j.score >= min && (role === null || j.role === role));
}

