/**
 * Pure card model for landing v4. A real job plus the sample profile ("Asha") in, a short, uncluttered card out.
 * No I/O, no clock (the caller passes `now`), no randomness: the same job always yields the same card.
 */
import { ASHA_SKILL_SET } from "../workflow/asha";
import { DEMO_FLOOR_USD_MINOR } from "../../landing/demo-model";
import { needsFor, safeHttpUrl, type NeedsField } from "../../landing-v3/stack/cards";

/** A job as the v4 loader returns it: JSON-safe, nothing derived for display yet. */
export type V4Job = {
  slug: string;
  title: string;
  company: string;
  logoPath: string | null;
  /** First entry of the job's location list, for example "San Francisco, California, United States". */
  place: string | null;
  countries: string[];
  workplace: string | null;
  skills: string[];
  /** Pay exactly as the posting states it (minor units), or null. */
  stated: { min: number | null; max: number | null; currency: string; period: string | null } | null;
  /** The stated pay as one string, for example "₹3,800,000–5,200,000/yr". Used as the tooltip's source. */
  statedText: string | null;
  /** Normalised annual USD (minor units). */
  usd: { min: number | null; max: number | null } | null;
  freshAt: string | null;
  postingUrl: string | null;
};

export type AshaScore = {
  matched: number;
  total: number;
  met: string[];
  missing: string[];
  score: number;
  /** null when the posting states no pay, so there is nothing to compare. */
  aboveFloor: boolean | null;
};

export const REQUIREMENTS_SCORED = 8;

/** Real intersection of the posting's requirements with the sample profile's skills, plus the real pay-floor check. */
export function scoreForAsha(skills: readonly string[], payMaxUsdMinor: number | null): AshaScore {
  const labels = [...new Set(skills.map((s) => s.trim()).filter(Boolean))].slice(0, REQUIREMENTS_SCORED);
  const met = labels.filter((l) => ASHA_SKILL_SET.has(l.toLowerCase()));
  const missing = labels.filter((l) => !ASHA_SKILL_SET.has(l.toLowerCase()));
  const aboveFloor = payMaxUsdMinor == null ? null : payMaxUsdMinor >= DEMO_FLOOR_USD_MINOR;
  const payPoints = aboveFloor === null ? 8 : aboveFloor ? 15 : 0;
  const score = labels.length === 0 ? 0 : Math.min(100, Math.round((met.length / labels.length) * 85 + payPoints));
  return { matched: met.length, total: labels.length, met, missing, score, aboveFloor };
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

/** "San Francisco · Onsite": the first place segment and the work mode. Never the full address. */
export function shortWhere(job: Pick<V4Job, "place" | "countries" | "workplace">): string {
  const first = job.place?.split(",")[0]?.trim();
  const where = first || job.countries.slice(0, 1).join("") || "";
  const mode = job.workplace ? cap(job.workplace) : "";
  return [where, mode].filter(Boolean).join(" · ") || "Location not stated";
}

/** "2h ago" becomes "2h"; "just now" stays. */
export function shortAgo(from: string | null, now: Date): string | null {
  if (!from) return null;
  const t = new Date(from).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.floor((now.getTime() - t) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const trim = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, "");

export type ShortPay = { text: string; converted: boolean };

const PER_YEAR: Record<string, number> = { year: 1, month: 12 };

/** "₹38–52 L / yr" or "$210–260K / yr". Local currency when the posting states it per year or month, otherwise USD a year. */
export function shortPay(stated: V4Job["stated"], usd: V4Job["usd"]): ShortPay | null {
  const mult = stated?.period ? PER_YEAR[stated.period] : undefined;
  if (stated && mult && (stated.min !== null || stated.max !== null) && (stated.currency === "INR" || stated.currency === "USD")) {
    const lo = stated.min === null ? null : (stated.min / 100) * mult;
    const hi = stated.max === null ? null : (stated.max / 100) * mult;
    const annualised = mult !== 1;
    if (stated.currency === "INR") {
      const a = lo === null ? null : lo / 100_000;
      const b = hi === null ? null : hi / 100_000;
      const body = a !== null && b !== null ? (trim(a) === trim(b) ? trim(a) : `${trim(a)}–${trim(b)}`) : trim((a ?? b)!) + (a !== null ? "+" : "");
      return { text: `₹${body} L / yr`, converted: annualised };
    }
    const a = lo === null ? null : lo / 1000;
    const b = hi === null ? null : hi / 1000;
    const body = a !== null && b !== null ? (Math.round(a) === Math.round(b) ? `${Math.round(a)}K` : `${Math.round(a)}–${Math.round(b)}K`) : `${Math.round((a ?? b)!)}K${a !== null ? "+" : ""}`;
    return { text: `$${body} / yr`, converted: annualised };
  }
  if (usd && (usd.min !== null || usd.max !== null)) {
    const a = usd.min === null ? null : usd.min / 100_000;
    const b = usd.max === null ? null : usd.max / 100_000;
    const body = a !== null && b !== null ? (Math.round(a) === Math.round(b) ? `${Math.round(a)}K` : `${Math.round(a)}–${Math.round(b)}K`) : `${Math.round((a ?? b)!)}K${a !== null ? "+" : ""}`;
    return { text: `$${body} / yr`, converted: true };
  }
  return null;
}

export type V4Card = {
  slug: string;
  company: string;
  logoPath: string | null;
  title: string;
  where: string;
  /** "2h", or null. */
  posted: string | null;
  pay: ShortPay | null;
  /** The words for the "from posting" tooltip. */
  paySource: string | null;
  aboveFloor: boolean | null;
  /** At most three, matched skills first. */
  chips: string[];
  /** The one-line "why it fits". */
  why: string;
  score: number;
  matched: number;
  total: number;
  reqs: { label: string; met: boolean }[];
  needs: NeedsField | null;
  postingUrl: string | null;
};

export const MAX_CHIPS = 3;

/** One line, 14px: names the gap when it is a real one, otherwise says what matched. */
export function whyLine(s: AshaScore): string {
  if (s.total === 0) return "The posting lists no requirements to compare";
  if (s.missing.length > 0 && s.matched / s.total < 0.75) return `${s.missing[0]} isn't on your resume`;
  const base = s.missing.length === 0 ? `Matches all ${s.total} requirements` : `Matches ${s.matched} of ${s.total} requirements`;
  if (s.aboveFloor === true) return `${base} · pay above your floor`;
  if (s.aboveFloor === false) return `${base} · pay below your floor`;
  return base;
}

export function buildV4Card(job: V4Job, now: Date): V4Card {
  const s = scoreForAsha(job.skills, job.usd?.max ?? job.usd?.min ?? null);
  const pay = shortPay(job.stated, job.usd);
  const chips = [...s.met, ...s.missing].slice(0, MAX_CHIPS);
  return {
    slug: job.slug,
    company: job.company,
    logoPath: job.logoPath,
    title: job.title,
    where: shortWhere(job),
    posted: shortAgo(job.freshAt, now),
    pay,
    paySource: pay ? (job.statedText ?? null) : null,
    aboveFloor: s.aboveFloor,
    chips,
    why: whyLine(s),
    score: s.score,
    matched: s.matched,
    total: s.total,
    reqs: [...s.met.map((label) => ({ label, met: true })), ...s.missing.map((label) => ({ label, met: false }))],
    needs: needsFor(job.slug),
    postingUrl: safeHttpUrl(job.postingUrl),
  };
}

/** Best match first; ties keep the freshest-first order the loader gave. */
export function buildV4Cards(jobs: readonly V4Job[], now: Date): V4Card[] {
  return jobs.map((j) => buildV4Card(j, now));
}
