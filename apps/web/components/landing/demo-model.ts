/** Pure rules for the landing demo. No I/O, no clock, no randomness: the same job always yields the same card. */

export const REQUIREMENTS_SHOWN = 8;

/** FNV-1a, 32 bit. Stable across server and browser, so the fixture maths never differ between renders. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type RequirementChip = { label: string; met: boolean };
export type FixtureMatch = {
  chips: RequirementChip[];
  matched: number;
  total: number;
  /** null when the posting states no pay, so the demo cannot compare it. */
  salaryAboveFloor: boolean | null;
  score: number;
  /** "9 of 11 requirements • salary above your floor", built from the chips actually shown. */
  maths: string;
};

/**
 * Fixture match for the demo card. The job is real; the resume is not, so which requirements are "met" is derived
 * from a hash of the slug. Between one and three requirements are always missing, so the card shows both outcomes.
 */
/** The demo resume's pay floor, ₹30 L a year, as annual USD minor units (about $34K at the 2026-10-15 rate). */
export const DEMO_FLOOR_USD_MINOR = 3_400_000;

export function matchFixture(slug: string, skills: readonly string[], payMaxUsdMinor: number | null = null): FixtureMatch {
  const labels = [...new Set(skills.map((s) => s.trim()).filter(Boolean))].slice(0, REQUIREMENTS_SHOWN);
  const total = labels.length;
  const h = hashString(slug);
  const want = total === 0 ? 0 : Math.min(total, 1 + (h % 3));
  const missing = new Set(
    labels
      .map((l, i) => ({ i, k: hashString(`${slug}:${l}:${i}`) }))
      .sort((x, y) => x.k - y.k || x.i - y.i)
      .slice(0, want)
      .map((x) => x.i),
  );
  const chips = labels.map((label, i) => ({ label, met: !missing.has(i) }));
  const matched = chips.filter((c) => c.met).length;
  // Compared for real against the job's normalised pay, never guessed.
  const salaryAboveFloor = payMaxUsdMinor == null ? null : payMaxUsdMinor >= DEMO_FLOOR_USD_MINOR;
  const payPoints = salaryAboveFloor === null ? 8 : salaryAboveFloor ? 15 : 0;
  const score = total === 0 ? 0 : Math.round((matched / total) * 85 + payPoints);
  const payText =
    salaryAboveFloor === null ? "pay not stated" : `salary ${salaryAboveFloor ? "above" : "below"} your floor`;
  const maths = `${matched} of ${total} requirements • ${payText}`;
  return { chips, matched, total, salaryAboveFloor, score, maths };
}

/** "just now", "12m ago", "2h ago", "3d ago". Future dates read as "just now". */
export function agoShort(from: Date | string, now: Date): string {
  const t = typeof from === "string" ? new Date(from).getTime() : from.getTime();
  const mins = Math.max(0, Math.floor((now.getTime() - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** "software-engineer-frontend" becomes "Software engineer frontend". */
export function roleLabel(slug: string): string {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** UTC wall time for an as-of stamp, for example "15 Oct, 19:30 UTC". Server-side only, so it never differs on hydration. */
export function asOfLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(d);
  return `${day}, ${time} UTC`;
}
