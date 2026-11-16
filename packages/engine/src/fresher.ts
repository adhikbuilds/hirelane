/**
 * A4: fresher flag. Pure and deterministic (no clock, no randomness).
 *
 * Precedence: required years >= 3 or a senior level/title => false; then explicit fresher words in the
 * title, intern level, fresher phrases in the description, a low years band (0-1, 0-2), and finally an
 * entry level with no years stated. Anything else is false with reason `no_signal`.
 */
import { evidence } from './internal/tracer';
import type { Level } from './classify/level';
import type { Evidence } from './trace';

export interface FresherRequirement {
  kind: string;
  text: string;
  yearsMin: number | null;
  spanStart: number;
  spanEnd: number;
}

export interface FresherInput {
  title: string;
  /** classifyLevel().value */
  level: Level | null;
  /** extractRequirements().requirements (or a subset); `nice` items are ignored for years. */
  requirements?: readonly FresherRequirement[];
  /** Description text; used for phrases and as a years fallback when no requirement carries years. */
  text?: string;
}

export interface FresherResult {
  fresher: boolean;
  reason: string;
  evidence: Evidence[];
}

export const FRESHER_MAX_LOWER_YEARS = 1;
export const FRESHER_MAX_UPPER_YEARS = 2;
export const SENIOR_MIN_YEARS = 3;

const TITLE_FRESHER_RE =
  /\b(?:interns?|internships?|co[- ]?op|new[- ]grad(?:uate)?s?|graduates?|fresher|freshers|entry[- ]level|campus|trainee|apprentice(?:ship)?|early career)\b/i;
const TITLE_SENIOR_RE =
  /\b(?:senior|sr\.?|snr|lead|staff|principal|distinguished|manager|head of|director|vp|vice president|chief|president)(?![\w])/i;

const TEXT_FRESHER_RES: { id: string; re: RegExp }[] = [
  { id: 'freshers', re: /\bfreshers?\b/i },
  { id: 'campus', re: /\b(?:off[- ]campus|campus (?:hiring|hire|drive|recruit\w*|placement|program\w*|graduates?|talent))\b/i },
  { id: 'batch', re: /\b(?:batch of 20\d\d|20\d\d batch|class of 20\d\d)\b/i },
  { id: 'new_grad', re: /\b(?:new[- ]grads?|new graduates?|fresh graduates?|recent graduates?|recent grads?|entry[- ]level)\b/i },
  { id: 'no_experience', re: /\bno (?:prior |previous |work |professional )?experience (?:is )?(?:required|needed|necessary)\b/i },
];

const NUM = '\\d{1,2}';
const RANGE_SRC = `(?<![\\w.$£€])(${NUM})(?:\\s*(?:-|–|—|to)\\s*(${NUM}))?\\s*\\+?\\s*(?:years?|yrs?)(?![A-Za-z])`;
const REQ_YEARS_RE = new RegExp(RANGE_SRC, 'i');
const TEXT_YEARS_RE = new RegExp(`${RANGE_SRC}(?:\\s+(?:of|in|with))?\\s*(?:[\\w-]+\\s+){0,3}?(?:experience|exposure|background)`, 'gi');

interface YearsItem {
  lo: number;
  hi: number;
  ev: Evidence;
}

function fromRequirements(reqs: readonly FresherRequirement[]): YearsItem[] {
  const out: YearsItem[] = [];
  for (const r of reqs) {
    if (r.kind === 'nice') continue;
    const m = REQ_YEARS_RE.exec(r.text);
    let lo: number;
    let hi: number;
    if (m) {
      lo = Number(m[1]);
      hi = m[2] !== undefined ? Number(m[2]) : lo;
    } else if (r.yearsMin !== null && Number.isFinite(r.yearsMin)) {
      lo = hi = r.yearsMin;
    } else continue;
    if (hi < lo) hi = lo;
    out.push({ lo, hi, ev: { ...evidence('description', r.text, 0, r.text.length), start: r.spanStart, end: r.spanEnd } });
  }
  return out;
}

function fromText(text: string): YearsItem[] {
  const out: YearsItem[] = [];
  TEXT_YEARS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEXT_YEARS_RE.exec(text)) !== null) {
    const lo = Number(m[1]);
    const hi = m[2] !== undefined ? Math.max(lo, Number(m[2])) : lo;
    out.push({ lo, hi, ev: evidence('description', text, m.index, m.index + m[0].length) });
  }
  return out;
}

export function assessFresher(input: FresherInput): FresherResult {
  const title = input.title ?? '';
  const text = input.text ?? '';
  const reqYears = fromRequirements(input.requirements ?? []);
  const years = reqYears.length > 0 ? reqYears : fromText(text);
  const no = (reason: string, ev: Evidence[] = []): FresherResult => ({ fresher: false, reason, evidence: ev });
  const yes = (reason: string, ev: Evidence[]): FresherResult => ({ fresher: true, reason, evidence: ev });

  const senior = years.filter((y) => y.lo >= SENIOR_MIN_YEARS).sort((a, b) => b.lo - a.lo)[0];
  if (senior) return no(`requires ${senior.lo}+ years of experience`, [senior.ev]);

  const titleFresher = TITLE_FRESHER_RE.exec(title);
  const titleEv = (m: RegExpExecArray): Evidence => evidence('title', title, m.index, m.index + m[0].length);

  if (input.level === 'senior' || input.level === 'lead' || input.level === 'executive') {
    return no(`level classified ${input.level}`);
  }
  const titleSenior = TITLE_SENIOR_RE.exec(title);
  if (titleSenior && !titleFresher) return no('senior title', [titleEv(titleSenior)]);

  if (titleFresher) return yes(`title says "${titleFresher[0]}"`, [titleEv(titleFresher)]);
  if (input.level === 'intern') return yes('level classified intern', title ? [evidence('title', title, 0, title.length)] : []);

  for (const { id, re } of TEXT_FRESHER_RES) {
    const m = new RegExp(re.source, 'i').exec(text);
    if (m) return yes(`description phrase (${id}): "${m[0]}"`, [evidence('description', text, m.index, m.index + m[0].length)]);
  }

  if (years.length > 0 && years.every((y) => y.lo <= FRESHER_MAX_LOWER_YEARS && y.hi <= FRESHER_MAX_UPPER_YEARS)) {
    const top = [...years].sort((a, b) => b.hi - a.hi)[0] as YearsItem;
    return yes(`requires at most ${top.lo === top.hi ? top.lo : `${top.lo}-${top.hi}`} years of experience`, [top.ev]);
  }

  if (input.level === 'entry' && years.length === 0) {
    return yes('level classified entry with no years required', title ? [evidence('title', title, 0, title.length)] : []);
  }
  return no('no_signal');
}
