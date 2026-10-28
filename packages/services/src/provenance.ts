import { ELIGIBILITY_FIELDS, type EligibilityField, type EligibilityValues, type FieldMeta } from './eligibility';
import type { ParsedResume } from './parsed';

type Entry = ParsedResume['education'][number];
type Suggestion = { value: string | number | boolean; confidence: 'high' | 'low' };

const lastOf = (parsed: ParsedResume, level: Entry['level']): Entry | undefined => parsed.education.filter((e) => e.level === level).at(-1);

/** What the parser itself found for each eligibility field. A field with no entry here has no parse source. */
export function parserSuggestions(parsed: ParsedResume): Partial<Record<EligibilityField, Suggestion>> {
  const out: Partial<Record<EligibilityField, Suggestion>> = {};
  const set = (f: EligibilityField, value: string | number | boolean | null | undefined, e: Entry) => {
    if (value !== null && value !== undefined) out[f] = { value, confidence: e.confidence };
  };
  const tenth = lastOf(parsed, '10th');
  if (tenth) {
    if (tenth.score?.kind === 'percent') set('pct_10', tenth.score.value, tenth);
    set('board_10', tenth.board, tenth);
  }
  const sec = lastOf(parsed, '12th') ?? lastOf(parsed, 'diploma');
  if (sec) {
    set('secondary_kind', sec.level === '12th' ? '12th' : 'diploma', sec);
    if (sec.score?.kind === 'percent') set('pct_secondary', sec.score.value, sec);
    set('board_secondary', sec.board, sec);
  }
  const grad = lastOf(parsed, 'ug') ?? lastOf(parsed, 'pg');
  if (grad) {
    set('degree', grad.degree, grad);
    set('branch_raw', grad.branch, grad);
    set('passout_year', grad.passoutYear, grad);
    if (grad.score) {
      set('grad_score', grad.score.value, grad);
      set('grad_scale', grad.score.scale, grad);
    }
  }
  if (parsed.backlogs.active !== null) out.active_backlogs = { value: parsed.backlogs.active, confidence: 'high' };
  if (parsed.backlogs.history !== null) out.backlog_history = { value: parsed.backlogs.history, confidence: 'high' };
  if (parsed.lateralEntry !== undefined) out.lateral_entry = { value: parsed.lateralEntry, confidence: 'high' };
  return out;
}

const same = (a: string | number | boolean, b: string | number | boolean): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.005;
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

/**
 * Provenance is decided here, never taken from the client (RP4, RP6). A submitted value equal to what the parser found
 * keeps source 'resume' and the parser's own confidence; anything else (an edit, a typed value, a field the parser has no
 * opinion on) is source 'user'. A low-confidence parser value therefore stays low until the student changes it.
 */
export function deriveFieldMeta(values: EligibilityValues, parsed: ParsedResume): FieldMeta {
  const suggested = parserSuggestions(parsed);
  const meta: FieldMeta = {};
  for (const f of ELIGIBILITY_FIELDS) {
    const v = values[f];
    if (v === undefined) continue;
    const s = suggested[f];
    meta[f] = s && same(s.value, v) ? { source: 'resume', confidence: s.confidence } : { source: 'user', confidence: 'high' };
  }
  return meta;
}
