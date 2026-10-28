/**
 * parseCriteria: drive-notice text to structured criteria with evidence offsets (Amendment B section 8).
 * Pure regex, no normalisation of the input, so every offset indexes the original string.
 * It extracts only what the notice states. Anything vague ("good academics", "60% aggregate" with no level,
 * "up to 2 backlogs" without saying history) yields no criterion, so it stays unknown downstream.
 *
 * Aliases: the tables below are local (data/branches.json and data/degrees.json did not exist when this was written).
 * They accept the lower-case ids those files use (cse, it, be, btech, ...). B.E and B.Tech are one code here because
 * notices write "B.E/B.Tech" as a single requirement; the data file keeps them apart.
 */
import type { EvidenceSpan } from '../resume/types';
import type { Criterion, CriterionLevel } from './types';

// ---------------------------------------------------------------- aliases

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const DEGREE_CODES: Record<string, string> = {
  btech: 'BTECH', be: 'BTECH', bachelorofengineering: 'BTECH', bacheloroftechnology: 'BTECH', bachelorofengineeringtechnology: 'BTECH',
  mtech: 'MTECH', me: 'MTECH', masterofengineering: 'MTECH', masteroftechnology: 'MTECH',
  mca: 'MCA', masterofcomputerapplications: 'MCA',
  bca: 'BCA', bachelorofcomputerapplications: 'BCA',
  bsc: 'BSC', bachelorofscience: 'BSC',
  msc: 'MSC', masterofscience: 'MSC',
  mba: 'MBA', bba: 'BBA',
  bcom: 'BCOM', bachelorofcommerce: 'BCOM', mcom: 'MCOM',
};

/** Normalise a free-text degree ("B.Tech", "Bachelor of Technology") to a code, or null when unmapped. */
export function canonDegree(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  return DEGREE_CODES[squash(raw)] ?? null;
}

const BRANCH_CODES: Record<string, string> = {
  cse: 'CSE', cs: 'CSE', computerscience: 'CSE', computerscienceandengineering: 'CSE', computerengineering: 'CSE',
  it: 'IT', informationtechnology: 'IT', informationtechnologyengineering: 'IT',
  ece: 'ECE', electronicsandcommunication: 'ECE', electronicsandcommunicationengineering: 'ECE',
  eee: 'EEE', electricalandelectronics: 'EEE', electricalandelectronicsengineering: 'EEE',
  ee: 'EE', electricalengineering: 'EE',
  entc: 'ENTC', electronicsandtelecommunication: 'ENTC',
  eie: 'EIE', instrumentation: 'EIE', electronicsandinstrumentation: 'EIE',
  mech: 'MECH', mechanical: 'MECH', mechanicalengineering: 'MECH',
  civil: 'CIVIL', civilengineering: 'CIVIL',
  chem: 'CHEM', chemical: 'CHEM', chemicalengineering: 'CHEM',
  aiml: 'AIML', aiandml: 'AIML', artificialintelligence: 'AIML', artificialintelligenceandmachinelearning: 'AIML', machinelearning: 'AIML',
  ds: 'DS', datascience: 'DS',
  // Codes used by data/branches.json that have no notice-side alias above.
  ise: 'ISE', aids: 'AIDS', cyber: 'CYBER', electrical: 'EE',
};

/** A branch that sits under a broader one: a student in AIML may or may not count as CSE. */
const BRANCH_PARENT: Record<string, string> = { AIML: 'CSE', DS: 'CSE', AIDS: 'CSE', CYBER: 'CSE', ISE: 'IT', EE: 'EEE' };

/** Normalise a free-text branch to a code, or null when unmapped. */
export function canonBranch(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const direct = BRANCH_CODES[squash(raw.replace(/&/g, ' and '))];
  if (direct) return direct;
  const noParen = squash(raw.replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and '));
  return BRANCH_CODES[noParen] ?? null;
}

/** True when two branch codes are the same or one specialises the other (so a mismatch is not a definite fail). */
export function branchesRelated(a: string, b: string): boolean {
  return a === b || BRANCH_PARENT[a] === b || BRANCH_PARENT[b] === a;
}

// ---------------------------------------------------------------- helpers

interface Span {
  start: number;
  end: number;
}
const span = (start: number, end: number): EvidenceSpan => ({ start, end });
const LEVEL_ORDER: CriterionLevel[] = ['10th', '12th', 'diploma', 'ug', 'pg'];

/** Clause boundaries: newline, ';', and a sentence-ending '.' before a capital or digit. Offsets into the original. */
function clauses(text: string): Span[] {
  const out: Span[] = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    let cut = ch === '\n' || ch === ';';
    if (!cut && ch === '.' && /\s/.test(text[i + 1] ?? '')) {
      const before = text.slice(Math.max(0, i - 8), i);
      const next = /\S/.exec(text.slice(i + 1));
      cut = !!next && /[A-Z0-9]/.test(next[0]) && /(?:[A-Za-z]{3,}|\d(?:st|nd|rd|th)|[\d%)])$/.test(before);
    }
    if (cut) {
      out.push({ start: from, end: i });
      from = i + 1;
    }
  }
  out.push({ start: from, end: text.length });
  return out.filter((c) => c.end > c.start);
}

function all(re: RegExp, s: string): RegExpExecArray[] {
  const g = re.global ? re : new RegExp(re.source, re.flags + 'g');
  g.lastIndex = 0;
  const out: RegExpExecArray[] = [];
  for (let m = g.exec(s); m; m = g.exec(s)) {
    out.push(m);
    if (m[0].length === 0) g.lastIndex++;
  }
  return out;
}

// ---------------------------------------------------------------- scores

interface ScoreMention {
  kind: 'pct' | 'cgpa';
  value: number;
  start: number;
  end: number;
}
interface LevelMention {
  level: CriterionLevel;
  start: number;
  end: number;
}

const PCT_RE = /(\d{1,3}(?:\.\d+)?)\s*(?:%|per\s?cent(?:age)?\b)/gi;
const CGPA_A = /(\d{1,2}(?:\.\d+)?)\s*(?:\/\s*10\s*)?(?:cgpa|cpi|gpa)\b/gi;
const CGPA_B = /\b(?:cgpa|cpi|gpa)\s*(?:of|:|-)?\s*(\d{1,2}(?:\.\d+)?)/gi;

const LEVEL_DEFS: Array<[CriterionLevel, RegExp]> = [
  ['pg', /\b(?:post[- ]?graduation|post[- ]?graduate|pg|master'?s?)\b/gi],
  ['10th', /\b(?:10th|tenth|ssc|sslc|matriculation|matric|class\s*10|class\s*x)\b/gi],
  ['10th', /\bX\b/g],
  ['12th', /\b(?:12th|twelfth|xii|hsc|intermediate|class\s*12|puc|plus\s*two)\b/gi],
  ['diploma', /\bdiploma\b/gi],
  ['ug', /\b(?:graduation|undergraduate|under[- ]graduate|ug|degree|bachelor'?s?)\b/gi],
];
const THROUGHOUT_RE = /\bthroughout\b|\bin\s+all\s+(?:the\s+)?(?:levels|examinations|academics)\b|\bat\s+every\s+level\b|\beach\s+level\b/i;

function scoreMentions(s: string): ScoreMention[] {
  const raw: ScoreMention[] = [];
  for (const m of all(PCT_RE, s)) {
    const v = Number(m[1]);
    if (v >= 10 && v <= 100) raw.push({ kind: 'pct', value: v, start: m.index, end: m.index + m[0].length });
  }
  for (const re of [CGPA_A, CGPA_B]) {
    for (const m of all(re, s)) {
      const v = Number(m[1]);
      if (v >= 1 && v <= 10) raw.push({ kind: 'cgpa', value: v, start: m.index, end: m.index + m[0].length });
    }
  }
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: ScoreMention[] = [];
  for (const r of raw) if (!out.length || r.start >= out[out.length - 1]!.end) out.push(r);
  return out;
}

function levelMentions(s: string): LevelMention[] {
  const raw: LevelMention[] = [];
  for (const [level, re] of LEVEL_DEFS) for (const m of all(re, s)) raw.push({ level, start: m.index, end: m.index + m[0].length });
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: LevelMention[] = [];
  for (const r of raw) if (!out.length || r.start >= out[out.length - 1]!.end) out.push(r);
  return out;
}

interface ScoreGroup {
  pct?: number;
  cgpa?: number;
  start: number;
  end: number;
}

function groupScores(s: string, mentions: ScoreMention[]): ScoreGroup[] {
  const groups: ScoreGroup[] = [];
  for (const m of mentions) {
    const last = groups[groups.length - 1];
    const between = last ? s.slice(last.end, m.start) : '';
    const joinable = last && /^\s*[([]?\s*(?:or|and|\/|,|&|equivalent(?:\s+to)?|i\.e\.?)?\s*[([]?\s*$/i.test(between);
    const hasKind = last && (m.kind === 'pct' ? last.pct !== undefined : last.cgpa !== undefined);
    if (last && joinable && !hasKind) {
      if (m.kind === 'pct') last.pct = m.value;
      else last.cgpa = m.value;
      last.end = m.end;
    } else {
      const g: ScoreGroup = { start: m.start, end: m.end };
      if (m.kind === 'pct') g.pct = m.value;
      else g.cgpa = m.value;
      groups.push(g);
    }
  }
  for (const g of groups) if (s[g.end] === ')') g.end++;
  return groups;
}

function parseScores(text: string, c: Span): Criterion[] {
  const s = text.slice(c.start, c.end);
  const groups = groupScores(s, scoreMentions(s));
  if (!groups.length) return [];
  const levels = levelMentions(s);
  const after = levels.length === 0 || groups[0]!.start < levels[0]!.start;
  const out: Criterion[] = [];
  groups.forEach((g, i) => {
    const prevEnd = i === 0 ? 0 : groups[i - 1]!.end;
    const nextStart = i === groups.length - 1 ? s.length : groups[i + 1]!.start;
    const mine = after ? levels.filter((l) => l.start >= g.end && l.start < nextStart) : levels.filter((l) => l.end <= g.start && l.start >= prevEnd);
    const tm = THROUGHOUT_RE.exec(s.slice(prevEnd, nextStart));
    const throughout = tm !== null;
    let set = [...new Set(mine.map((l) => l.level))];
    let lo = Math.min(g.start, ...mine.map((l) => l.start));
    let hi = Math.max(g.end, ...mine.map((l) => l.end));
    if (tm) {
      lo = Math.min(lo, prevEnd + tm.index);
      hi = Math.max(hi, prevEnd + tm.index + tm[0].length);
    }
    if (set.length === 0) {
      if (!throughout) return;
      set = ['10th', '12th', 'ug'];
    }
    set.sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b));
    const crit: Criterion = {
      type: 'min_score',
      levels: set,
      // CGPA-only notices have no percentage: NaN, which JSON turns into null. Consumers treat non-finite as absent.
      pct: g.pct ?? Number.NaN,
      throughout,
      evidence: [span(c.start + lo, c.start + hi)],
    };
    if (g.cgpa !== undefined) crit.cgpa = g.cgpa;
    out.push(crit);
  });
  return out;
}

// ---------------------------------------------------------------- backlogs, gap, years

const NOBL_RES: RegExp[] = [
  /\b(?:no|zero|nil|0|without(?:\s+any)?)\s+(?:active|current|standing|pending|outstanding|live)\s+(?:backlogs?|arrears?)\b/gi,
  /\bnot\s+have\s+any\s+(?:(?:active|current|standing|pending)\s+)?(?:backlogs?|arrears?)\b/gi,
  /\b(?:active|standing|pending)\s+(?:backlogs?|arrears?)\s+(?:are\s+)?not\s+(?:allowed|permitted|accepted)\b/gi,
];
const BLH_PREFIX = /\b(?:max(?:imum)?|up\s*to|at\s+most|not\s+more\s+than|no\s+more\s+than)\s+(?:of\s+)?(\d+)\s+(?:backlogs?|arrears?)\s+(?:history\b|in\s+(?:the\s+)?(?:entire\s+|whole\s+|overall\s+)?(?:history|academics|academic\s+history|career)\b)/gi;
const BLH_NONE = /\bno\s+backlogs?\s+history\b/gi;

function parseBacklogs(text: string): Criterion[] {
  const out: Criterion[] = [];
  const seen: Span[] = [];
  for (const re of NOBL_RES)
    for (const m of all(re, text)) {
      const sp = { start: m.index, end: m.index + m[0].length };
      if (seen.some((x) => sp.start < x.end && x.start < sp.end)) continue;
      seen.push(sp);
      out.push({ type: 'no_active_backlogs', evidence: [span(sp.start, sp.end)] });
    }
  for (const m of all(BLH_PREFIX, text)) out.push({ type: 'max_backlog_history', n: Number(m[1]), evidence: [span(m.index, m.index + m[0].length)] });
  for (const m of all(BLH_NONE, text)) out.push({ type: 'max_backlog_history', n: 0, evidence: [span(m.index, m.index + m[0].length)] });
  return out;
}

const GAP_LIMIT = /\bgaps?\b[^.;\n]{0,30}?\b(?:exceed|up\s*to|upto|max(?:imum)?(?:\s+of)?|at\s+most|not\s+more\s+than|no\s+more\s+than|within|less\s+than|of)\s+(\d+(?:\.\d+)?)\s*years?\b/gi;
const GAP_PREFIX = /\b(?:max(?:imum)?|up\s*to|upto|at\s+most)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*years?\s+(?:of\s+)?(?:education(?:al)?\s+)?gaps?\b/gi;
const GAP_NONE = /\b(?:no|zero)\s+(?:education(?:al)?\s+)?gaps?\b|\bgaps?\s+(?:is\s+|are\s+)?not\s+(?:allowed|permitted|accepted)\b/gi;

function parseGap(text: string): Criterion[] {
  const out: Criterion[] = [];
  const seen: Span[] = [];
  const push = (m: RegExpExecArray, n: number): void => {
    const sp = { start: m.index, end: m.index + m[0].length };
    if (seen.some((x) => sp.start < x.end && x.start < sp.end)) return;
    seen.push(sp);
    out.push({ type: 'max_gap_years', n, evidence: [span(sp.start, sp.end)] });
  };
  for (const m of all(GAP_LIMIT, text)) push(m, Number(m[1]));
  for (const m of all(GAP_PREFIX, text)) push(m, Number(m[1]));
  for (const m of all(GAP_NONE, text)) push(m, 0);
  return out;
}

const YEAR_CHAIN = /\b20\d{2}(?:\s*(?:,|\/|&|\band\b|\bor\b|-|–|\bto\b)\s*20\d{2})*\b/gi;
const YEAR_AFTER = /^\s*(?:pass[- ]?outs?|passing[- ]out|batch(?:es)?|graduates?|grads?|yop)\b/i;
const YEAR_BEFORE = /(?:\byop|year\s+of\s+(?:passing|passout|graduation)|passing[- ]out(?:\s+year)?|pass[- ]?out(?:\s+year)?|passed[- ]out|\bbatch(?:es)?|graduates?\s+of|graduating|graduated)\s*(?:of|in|:|-|–)?\s*$/i;

function parseYears(text: string): Criterion[] {
  const out: Criterion[] = [];
  for (const m of all(YEAR_CHAIN, text)) {
    const start = m.index;
    const end = start + m[0].length;
    const aft = YEAR_AFTER.exec(text.slice(end, end + 30));
    const lead = text.slice(Math.max(0, start - 40), start);
    const bef = YEAR_BEFORE.exec(lead);
    if (!aft && !bef) continue;
    const years = (m[0].match(/20\d{2}/g) ?? []).map(Number);
    const seps = m[0].split(/20\d{2}/).slice(1, -1);
    const set = new Set<number>([years[0]!]);
    const batchKw = !!bef && /batch/i.test(bef[0]);
    for (let i = 1; i < years.length; i++) {
      const lo = years[i - 1]!;
      const hi = years[i]!;
      const isRange = /-|–|\bto\b/i.test(seps[i - 1] ?? '');
      if (isRange && hi >= lo && hi - lo <= 6) {
        // "batch 2022-2026" is an academic session (start-end), so only the end year is the passout year.
        if (batchKw && hi - lo >= 3) set.clear();
        else for (let y = lo; y <= hi; y++) set.add(y);
        set.add(hi);
      } else set.add(hi);
    }
    const es = bef ? start - bef[0].length : start;
    const ee = aft ? end + aft[0].length : end;
    out.push({ type: 'passout_years', years: [...set].sort((a, b) => a - b), evidence: [span(Math.max(0, es), ee)] });
  }
  return out;
}

// ---------------------------------------------------------------- degrees and branches

const DEGREE_PATTERNS: Array<[RegExp, string]> = [
  [/\bB\.?\s?Tech\b/gi, 'BTECH'],
  [/\bB\.E\b|\bBE\b/g, 'BTECH'],
  [/\bbachelor\s+of\s+(?:engineering|technology)\b/gi, 'BTECH'],
  [/\bM\.?\s?Tech\b/gi, 'MTECH'],
  [/\bM\.E\b|\bME\b/g, 'MTECH'],
  [/\bmaster\s+of\s+(?:engineering|technology)\b/gi, 'MTECH'],
  [/\bMCA\b/gi, 'MCA'],
  [/\bBCA\b/gi, 'BCA'],
  [/\bB\.?\s?Sc\b/gi, 'BSC'],
  [/\bM\.?\s?Sc\b/gi, 'MSC'],
  [/\bMBA\b/gi, 'MBA'],
  [/\bBBA\b/gi, 'BBA'],
  [/\bB\.?\s?Com\b/gi, 'BCOM'],
  [/\bM\.?\s?Com\b/gi, 'MCOM'],
];

interface DegreeHit {
  code: string;
  start: number;
  end: number;
}

function degreeHits(text: string): DegreeHit[] {
  const raw: DegreeHit[] = [];
  for (const [re, code] of DEGREE_PATTERNS) for (const m of all(re, text)) raw.push({ code, start: m.index, end: m.index + m[0].length });
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: DegreeHit[] = [];
  for (const r of raw) if (!out.length || r.start >= out[out.length - 1]!.end) out.push(r);
  return out;
}

interface BranchHit {
  codes: string[];
  start: number;
  end: number;
  /** Bare "IT"/"CS" are too common in prose to count alone. */
  ambiguous: boolean;
}

const BRANCH_PATTERNS: Array<[RegExp, string[], boolean]> = [
  [/\bcircuit\s+branch(?:es)?\b/gi, ['ECE', 'EEE', 'EIE'], false],
  [/\bcomputer\s+science(?:\s+(?:and|&)\s+engineering)?\b/gi, ['CSE'], false],
  [/\binformation\s+technology\b/gi, ['IT'], false],
  [/\belectronics\s+(?:and|&)\s+communication\b/gi, ['ECE'], false],
  [/\belectrical\s+(?:and|&)\s+electronics\b/gi, ['EEE'], false],
  [/\belectronics\s+(?:and|&)\s+telecommunication\b/gi, ['ENTC'], false],
  [/\bmechanical\b/gi, ['MECH'], false],
  [/\bcivil\b/gi, ['CIVIL'], false],
  [/\bchemical\b/gi, ['CHEM'], false],
  [/\binstrumentation\b/gi, ['EIE'], false],
  [/\bartificial\s+intelligence\b/gi, ['AIML'], false],
  [/\bdata\s+science\b/gi, ['DS'], false],
  [/\bCSE\b/g, ['CSE'], false],
  [/\bECE\b/g, ['ECE'], false],
  [/\bEEE\b/g, ['EEE'], false],
  [/\bEIE\b/g, ['EIE'], false],
  [/\bENTC\b/g, ['ENTC'], false],
  [/\bMECH\b/g, ['MECH'], false],
  [/\bAIML\b/g, ['AIML'], false],
  [/\bCS\b/g, ['CSE'], true],
  [/\bIT\b/g, ['IT'], true],
  [/\bEE\b/g, ['EE'], true],
];
const BRANCH_CONTEXT = /\b(?:only|branch(?:es)?|streams?|disciplines?|from|specialis?ations?|eligible|departments?)\b/i;
const ALL_BRANCHES = /\ball\s+(?:the\s+)?(?:branches|streams|disciplines)\b/i;

function branchHits(text: string): BranchHit[] {
  const raw: BranchHit[] = [];
  for (const [re, codes, ambiguous] of BRANCH_PATTERNS) for (const m of all(re, text)) raw.push({ codes, ambiguous, start: m.index, end: m.index + m[0].length });
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: BranchHit[] = [];
  for (const r of raw) if (!out.length || r.start >= out[out.length - 1]!.end) out.push(r);
  return out;
}

function parseDegreesAndBranches(text: string): Criterion[] {
  const out: Criterion[] = [];
  const degrees = degreeHits(text);
  if (degrees.length) {
    const codes = [...new Set(degrees.map((d) => d.code))].sort();
    out.push({ type: 'degrees', list: codes, evidence: degrees.map((d) => span(d.start, d.end)) });
  }

  // A parenthesis right after a degree qualifies that degree ("M.Sc (CS/IT)"), not the whole notice, unless it is an
  // explicit branch list on an engineering degree. Qualified ones are masked from branch parsing and dropped (unknown).
  let masked = text;
  const explicit: Span[] = [];
  for (const d of degrees) {
    const paren = /^\s*\(([^)]*)\)/.exec(text.slice(d.end));
    if (!paren) continue;
    const ps = d.end + paren[0].indexOf('(');
    const pe = d.end + paren[0].length;
    const inner = branchHits(paren[1]!);
    if ((d.code === 'BTECH' || d.code === 'MTECH') && new Set(inner.flatMap((h) => h.codes)).size >= 2) explicit.push({ start: ps, end: pe });
    else masked = masked.slice(0, ps) + ' '.repeat(pe - ps) + masked.slice(pe);
  }

  for (const c of clauses(text)) {
    const seg = masked.slice(c.start, c.end);
    if (ALL_BRANCHES.test(seg)) continue;
    const hits = branchHits(seg);
    if (!hits.length) continue;
    const codes = [...new Set(hits.flatMap((h) => h.codes))];
    const hasExplicit = explicit.some((e) => e.start >= c.start && e.end <= c.end);
    const circuit = hits.some((h) => h.codes.length > 1);
    const strong = hits.some((h) => !h.ambiguous);
    if (!(hasExplicit || circuit || (BRANCH_CONTEXT.test(seg) && (codes.length >= 2 || strong)))) continue;
    out.push({
      type: 'branches',
      list: codes.sort(),
      evidence: hits.map((h) => span(c.start + h.start, c.start + h.end)),
    });
  }
  return out;
}

// ---------------------------------------------------------------- entry

/** Extract every stated academic criterion from a drive notice, ordered by position in the text. */
export function parseCriteria(text: string): Criterion[] {
  if (typeof text !== 'string' || text.trim() === '') return [];
  const out: Criterion[] = [];
  for (const c of clauses(text)) out.push(...parseScores(text, c));
  out.push(...parseBacklogs(text), ...parseGap(text), ...parseYears(text), ...parseDegreesAndBranches(text));
  return out.sort((a, b) => a.evidence[0]!.start - b.evidence[0]!.start);
}
