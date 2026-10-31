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
  /** pct = a * cgpa + b */
  a: number;
  b: number;
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
}

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

export function toCgpaRule(r: UniversityRule): NonNullable<CgpaRule> {
  return { kind: 'linear', a: r.a, b: r.b };
}
