/**
 * Per-university CGPA to percentage rules (PRD E5). Data lives in data/cgpa-rules.json.
 * A row with verified:false is entered from memory and is used only after the student or the campus confirms it.
 */
import rulesJson from '../../data/cgpa-rules.json';
import type { CgpaRule } from './types';

export interface UniversityRule {
  id: string;
  name: string;
  /** Short name used in sentences: "by RGPV's rule". */
  short: string;
  aliases: string[];
  kind: 'linear';
  /** pct = a * cgpa + b. null when the formula depends on the scheme (see `variants`): there is no single formula. */
  a: number | null;
  b: number | null;
  scale: 10;
  formula: string;
  applies_to: string;
  source_url: string;
  source_kind: string;
  checked_on: string;
  check_method: string;
  verified: boolean;
  confidence: 'high' | 'medium' | 'low';
  note: string;
  example: { cgpa: number; pct: number };
  /** Other links for the same rule (third-party sites, or the document to read). `source_url` is the one shown. */
  source_urls?: string[];
  /** The university's own document, when known: "Lr.No. 3452/AU/CAC/CGPA2020 dated 29.12.2020". */
  source_document?: string;
  /** The regulations the rule covers, when the source limits it: ["R-2015", "R-2018", "R-2019"]. Recorded, not enforced. */
  scope?: string[];
  /** Formulas that differ by scheme or admission year. Set => `a` and `b` are null and the student's scheme decides. */
  variants?: RuleVariant[];
  /** The rule may no longer be in force. A disputed row is never converted, even when the student confirms it. */
  disputed?: { since: string; reason: string; message: string };
}

export interface RuleVariant {
  id: string;
  label: string;
  /** Scheme years: "2018". */
  schemes: string[];
  /** Admission years that this scheme is documented for. Other years are unknown, never the nearest. */
  admission_years: number[];
  a: number;
  b: number;
  formula: string;
  example: { cgpa: number; pct: number };
}

/** What the student told us that picks a variant. Both optional; neither is ever taken from the passout year. */
export interface RuleContext {
  scheme?: string | null;
  admissionYear?: number | null;
}

export type RuleResolution =
  | { ok: true; rule: { kind: 'linear'; a: number; b: number }; variant?: string }
  | { ok: false; reason: string };

const ROWS = (rulesJson as { rules: UniversityRule[] }).rules;

export function universityRules(): readonly UniversityRule[] {
  return ROWS;
}

function norm(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.,'’()]/g, '')
    .replace(/[-_/&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Entry {
  rule: UniversityRule;
  key: string;
  /** Ids are exact-match only: "gujarat" or "mumbai" inside a longer line names a place, not a university. */
  exactOnly: boolean;
}
const ENTRIES: Entry[] = [];
for (const rule of ROWS) {
  // A school-board row (CBSE ...) converts school CGPA, never a university degree: it must not be found by a graduation lookup.
  if (/^school\b/i.test(rule.applies_to)) continue;
  ENTRIES.push({ rule, key: norm(rule.id), exactOnly: true });
  // "Mahatma Gandhi University, Kerala" is not "Mahatma Gandhi University" (Nalgonda, Meghalaya ...): an alias that is only the
  // name without its place qualifier is ambiguous, so it is not a key. The full name and the place-specific aliases remain.
  const placeless = rule.name.includes(',') ? norm(rule.name.split(',')[0]!) : null;
  for (const k of [rule.name, rule.short, ...rule.aliases]) {
    const key = norm(k);
    if (placeless !== null && key === placeless) continue;
    ENTRIES.push({ rule, key, exactOnly: false });
  }
}

/**
 * Looks a university up by id, name or alias. Exact match first; then a name or alias of 3+ characters found as whole words
 * inside a longer line ("ABC Institute, affiliated to VTU"). Returns null when nothing matches, never a guess.
 */
export function findUniversityRule(query: string | null | undefined): UniversityRule | null {
  if (typeof query !== 'string') return null;
  const q = norm(query);
  if (!q) return null;
  const exact = ENTRIES.find((e) => e.key === q);
  if (exact) return exact.rule;
  const padded = ` ${q} `;
  let best: Entry | null = null;
  for (const e of ENTRIES) {
    if (e.exactOnly || e.key.length < 3 || !padded.includes(` ${e.key} `)) continue;
    if (!best || e.key.length > best.key.length) best = e;
  }
  return best ? best.rule : null;
}

/** The year in a scheme the student typed: "2022", "2022 scheme", "VTU 2018". Null when there is no single year. */
function schemeYear(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = s.match(/\b(?:19|20)\d{2}\b/g);
  return m && new Set(m).size === 1 ? m[0]! : null;
}

/**
 * Picks the formula to use for a student. Never guesses: a disputed rule, a rule that needs a scheme the student has not
 * given, a scheme or admission year the table does not name, and a scheme that contradicts the admission year are all
 * `ok:false` with a plain reason.
 */
export function resolveUniversityRule(r: UniversityRule, ctx: RuleContext = {}): RuleResolution {
  if (r.disputed) return { ok: false, reason: `${r.short}'s conversion may have changed (${r.disputed.reason}). ${r.disputed.message}` };
  if (!r.variants) {
    if (typeof r.a !== 'number' || typeof r.b !== 'number') return { ok: false, reason: `We have no formula for ${r.short} yet` };
    return { ok: true, rule: { kind: 'linear', a: r.a, b: r.b } };
  }
  const ask = `We couldn't check: which ${r.short} scheme are you on?`;
  const y = ctx.admissionYear;
  const byYear = typeof y === 'number' && Number.isFinite(y) ? r.variants.find((v) => v.admission_years.includes(y)) : undefined;
  const given = ctx.scheme === null || ctx.scheme === undefined || (typeof ctx.scheme === 'string' && ctx.scheme.trim() === '') ? null : ctx.scheme;
  if (given !== null) {
    const sy = schemeYear(given);
    const byScheme = sy === null ? undefined : r.variants.find((v) => v.schemes.includes(sy));
    if (!byScheme) return { ok: false, reason: `${ask} We have no rule for the scheme "${String(given).trim().slice(0, 40)}"` };
    if (typeof y === 'number' && Number.isFinite(y) && byYear && byYear !== byScheme) return { ok: false, reason: `${ask} Your scheme and admission year point to different rules` };
    return { ok: true, rule: { kind: 'linear', a: byScheme.a, b: byScheme.b }, variant: byScheme.id };
  }
  if (byYear) return { ok: true, rule: { kind: 'linear', a: byYear.a, b: byYear.b }, variant: byYear.id };
  return { ok: false, reason: ask };
}

/** The linear rule for a student, or null when the rule is disputed or needs a scheme that is missing. */
export function toCgpaRule(r: UniversityRule, ctx: RuleContext = {}): CgpaRule {
  const res = resolveUniversityRule(r, ctx);
  return res.ok ? res.rule : null;
}
