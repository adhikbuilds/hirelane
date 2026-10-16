/** The compact row the board sends to the browser: everything a row and its panel header show, nothing more. */
import { formatAge } from "../../lib/format";
import type { PublicJob } from "../../lib/queries/jobs";
import { whereSummary } from "./locations";
import { payColumn } from "./pay";

export type Freshness = "new" | "week" | "old";
export type BoardRow = {
  slug: string;
  title: string;
  company: { slug: string; name: string; logoPath: string | null };
  /** Location chips: the place summary first, then the workplace. */
  chips: string[];
  /** Annual figure in the viewer's currency, or null when the posting states no pay. */
  pay: string | null;
  /** The posting's own wording when it differs from `pay`. */
  payNote: string | null;
  age: string;
  freshAt: string;
  fresh: Freshness;
  skills: string[];
  ats: string;
  level: string | null;
  employment: string | null;
};

const DAY = 24 * 3_600_000;
export const MAX_ROW_SKILLS = 3;

export function freshness(at: string | Date, now: Date): Freshness {
  const age = now.getTime() - new Date(at).getTime();
  return age < DAY ? "new" : age < 7 * DAY ? "week" : "old";
}

/** `logoUrl` is origin-prefixed in the public shape; the logo component wants the same-origin path. */
export function logoPathOf(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  try {
    const u = new URL(logoUrl);
    return u.pathname.startsWith("/") ? u.pathname : null;
  } catch {
    return logoUrl.startsWith("/") ? logoUrl : null;
  }
}

export function toBoardRow(j: PublicJob, pref: "USD" | "INR", now: Date): BoardRow {
  const w = whereSummary(j);
  const place = w.primary ? `${w.primary}${w.more > 0 ? ` +${w.more}` : ""}` : null;
  const chips = [place, w.workplace].filter((c): c is string => Boolean(c));
  const p = payColumn(j.salary, pref);
  return {
    slug: j.slug,
    title: j.title,
    company: { slug: j.company.slug, name: j.company.name, logoPath: logoPathOf(j.company.logoUrl) },
    chips,
    pay: p?.main ?? null,
    payNote: p?.original ?? null,
    age: formatAge(new Date(j.freshAt), now),
    freshAt: j.freshAt,
    fresh: freshness(j.freshAt, now),
    skills: j.skills.slice(0, MAX_ROW_SKILLS).map((s) => s.label),
    ats: j.ats,
    level: j.level,
    employment: j.employment,
  };
}

export const FRESH_LABEL: Record<Freshness, string> = { new: "Posted in the last day", week: "Posted this week", old: "Posted over a week ago" };
export const ATS_LABEL: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby" };
