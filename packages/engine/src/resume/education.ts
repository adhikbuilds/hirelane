/**
 * Education parser (Slice 1, task S1.5). Pure and rules-only, India-aware: boards, SSLC/PUC/HSC,
 * diploma lateral entry, CGPA/SGPA scales, ATKT/KT. No LLM, no I/O, no node:* imports.
 *
 * Offsets in EducationEntry.evidence are UTF-16 indexes into the text passed in, [start, end).
 * Callers pass normalizeResumeText output. Scores are never clamped: an out-of-range score is
 * kept as written and the entry is marked low confidence. Active backlogs and backlog history
 * are kept separate.
 */
import boardsData from '../../data/boards.json';
import branchesData from '../../data/branches.json';
import degreesData from '../../data/degrees.json';
import qualificationsData from '../../data/qualifications.json';
import { findMarks } from './normalize';
import { detectSections } from './sections';
import type { Backlogs, Confidence, EducationEntry, EducationLevel, EducationScore, EvidenceSpan, ResumeSection } from './types';

export interface EducationParse {
  entries: EducationEntry[];
  backlogs: Backlogs;
  /** Diploma holder admitted directly to the second year of a degree. */
  lateralEntry: boolean;
}

// ---------------------------------------------------------------------------------------------
// Alias tables
// ---------------------------------------------------------------------------------------------

interface Compiled<T> {
  value: T;
  re: RegExp;
  /** Alias length, used to prefer the longest match. */
  len: number;
}

function escapeChar(ch: string): string {
  return /[\^$\\.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch;
}

function tokenSource(tok: string): string {
  let out = '';
  for (let i = 0; i < tok.length; i++) {
    const ch = tok[i]!;
    if (ch === '.') out += /\p{L}/u.test(tok[i + 1] ?? '') ? '\\.?\\s?' : '\\.?';
    else if (ch === '-') out += '[-\\s]?';
    else out += escapeChar(ch);
  }
  return out;
}

/** Aliases with at most 2 letters ("x", "be", "it", "cs", "pu") match upper-case only. */
function compileAlias(alias: string, global = false): { re: RegExp; len: number } {
  const caseSensitive = /^[a-z]{1,2}$/i.test(alias.replace(/[.\s-]/g, ''));
  const a = caseSensitive ? alias.toUpperCase() : alias.toLowerCase();
  const parts = a.split(' ').filter(Boolean);
  let src = '';
  let prevAnd = false;
  parts.forEach((tok, i) => {
    if ((tok === 'and' || tok === 'AND') && i > 0 && i < parts.length - 1) {
      src += '(?:\\s+and\\s+|\\s*&\\s*)';
      prevAnd = true;
      return;
    }
    if (i > 0 && !prevAnd) src += '\\s+';
    prevAnd = false;
    src += tokenSource(tok);
  });
  const flags = (caseSensitive ? '' : 'i') + 'u' + (global ? 'g' : '');
  return { re: new RegExp(`(?<![\\p{L}\\p{N}])${src}(?![\\p{L}\\p{N}])`, flags), len: alias.length };
}

interface QualRaw { id: string; aliases: string[] }
interface DegreeRaw { id: string; level: string; durationYears: number; aliases: string[] }
interface BranchRaw { code: string; aliases: string[] }
interface BoardRaw { label: string; kind: string; aliases: string[] }

type LevelValue = { level: EducationLevel; degree: string | null; duration: number | null; weak?: boolean };
/** Aliases that are also common inside school names ("Example High School"): only a level at the start of a line. */
const WEAK_ALIASES = new Set(['high school', 'secondary']);
const LEVEL_ENTRIES: Compiled<LevelValue>[] = [];
for (const q of (qualificationsData as { qualifications: QualRaw[] }).qualifications)
  for (const a of q.aliases) LEVEL_ENTRIES.push({ value: { level: q.id as EducationLevel, degree: null, duration: null, weak: WEAK_ALIASES.has(a) }, ...compileAlias(a, true) });
for (const d of (degreesData as { degrees: DegreeRaw[] }).degrees)
  for (const a of d.aliases) LEVEL_ENTRIES.push({ value: { level: d.level as EducationLevel, degree: d.id, duration: d.durationYears }, ...compileAlias(a, true) });

const BRANCH_ENTRIES: Compiled<string>[] = [];
for (const b of (branchesData as { branches: BranchRaw[] }).branches) for (const a of b.aliases) BRANCH_ENTRIES.push({ value: b.code, ...compileAlias(a) });

const BOARD_ENTRIES: Compiled<{ label: string; kind: string }>[] = [];
const LONG_BOARD_MASKS: RegExp[] = [];
for (const b of (boardsData as { boards: BoardRaw[] }).boards)
  for (const a of b.aliases) {
    BOARD_ENTRIES.push({ value: { label: b.label, kind: b.kind }, ...compileAlias(a) });
    if (a.length > 12) LONG_BOARD_MASKS.push(compileAlias(a, true).re);
  }

const BOARD_KINDS: Record<EducationLevel, string[]> = {
  '10th': ['school', 'state'],
  '12th': ['school', 'state'],
  diploma: ['diploma_board', 'university'],
  ug: ['university'],
  pg: ['university'],
};

// ---------------------------------------------------------------------------------------------
// Level detection
// ---------------------------------------------------------------------------------------------

interface LevelHit extends LevelValue {
  start: number;
  end: number;
}

const NAME_WORD = /^\s*(?:school|college|vidyalaya|vidyalayam|academy|institute|mandir|public)\b/i;

function maskLongBoards(line: string): string {
  let out = line;
  for (const re of LONG_BOARD_MASKS) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => ' '.repeat(m.length));
  }
  return out;
}

/** The earliest level token on a line, skipping school names such as "Senior Secondary School". */
function findLevel(line: string): LevelHit | null {
  const masked = maskLongBoards(line);
  const hits: LevelHit[] = [];
  for (const e of LEVEL_ENTRIES) {
    e.re.lastIndex = 0;
    for (const m of masked.matchAll(e.re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (NAME_WORD.test(masked.slice(end))) continue;
      if (e.value.weak && /\p{L}/u.test(masked.slice(0, start))) continue;
      hits.push({ ...e.value, start, end });
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  return hits[0]!;
}

// ---------------------------------------------------------------------------------------------
// Boards and branches
// ---------------------------------------------------------------------------------------------

function findBoard(text: string, level: EducationLevel): { label: string; start: number; end: number } | null {
  const kinds = BOARD_KINDS[level];
  let best: { label: string; start: number; end: number; len: number } | null = null;
  for (const e of BOARD_ENTRIES) {
    if (!kinds.includes(e.value.kind)) continue;
    const m = e.re.exec(text);
    if (!m) continue;
    const len = m[0].length;
    if (!best || len > best.len || (len === best.len && m.index < best.start)) best = { label: e.value.label, start: m.index, end: m.index + len, len };
  }
  return best;
}

function findBranchEarliest(text: string): string | null {
  let best: { code: string; start: number; len: number } | null = null;
  for (const e of BRANCH_ENTRIES) {
    const m = e.re.exec(text);
    if (!m) continue;
    if (!best || m.index < best.start || (m.index === best.start && m[0].length > best.len)) best = { code: e.value, start: m.index, len: m[0].length };
  }
  return best ? best.code : null;
}

/** Canonical branch code for free text such as "Electronics & Communication", or null. */
export function normalizeBranch(raw: string): string | null {
  return typeof raw === 'string' ? findBranchEarliest(raw) : null;
}

const INSTITUTION = /\b(?:college|institut\w*|universit\w*|school|polytechnic|academy|vidyalaya)\b/i;
const BRANCH_LABEL = /(?:branch|specialization|specialisation|stream|major|discipline)\s*[:\-]\s*([^\n|;]+)/i;

function findBranch(first: string, rest: string, degreeEnd: number, degreeStart: number): string | null {
  const labelled = BRANCH_LABEL.exec(`${first}\n${rest}`);
  if (labelled) {
    const code = findBranchEarliest(labelled[1]!);
    if (code) return code;
  }
  let after = first.slice(degreeEnd, degreeEnd + 90);
  const cut = INSTITUTION.exec(after);
  if (cut) after = after.slice(0, cut.index);
  const a = findBranchEarliest(after);
  if (a) return a;
  for (const line of rest.split('\n')) {
    if (!line.trim() || INSTITUTION.test(line)) continue;
    const code = findBranchEarliest(line);
    if (code) return code;
  }
  return findBranchEarliest(first.slice(0, degreeStart));
}

// ---------------------------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------------------------

interface ScoreHit {
  score: EducationScore;
  start: number;
  end: number;
  /** Semester GPA rather than cumulative. */
  sgpa: boolean;
  /** The scale was not written on the page and had to be assumed. */
  assumedScale: boolean;
}

const NUM_DEC = '\\d{1,3}(?:\\.\\d{1,3})?';
const P_SYMBOL = new RegExp(`(?<![\\d.])(${NUM_DEC})[ \\t]*(?:%|per[ \\t]*cent\\b|percent\\b)`, 'giu');
const P_WORD = new RegExp(`\\b(?:percentage|aggregate|percent)[ \\t]*(?:of|:|-|–|=|is)?[ \\t]*(${NUM_DEC})(?![\\d.]|[ \\t]*/)`, 'giu');
const G_KEY = '(cgpa|sgpa|gpa|cpi|spi|c\\.g\\.p\\.a)';
const G_FWD = new RegExp(`(?<![\\p{L}\\d])${G_KEY}(?![\\p{L}])[ \\t]*(?:\\([^)\\n]{0,25}\\))?[ \\t]*(?::|-|–|=|of|is)?[ \\t]*(\\d{1,3}(?:\\.\\d{1,3})?)(?![\\d])(?:[ \\t]*(?:/|out[ \\t]+of)[ \\t]*(\\d{1,3}(?:\\.\\d{1,2})?)(?![\\d]))?`, 'giu');
const G_REV = new RegExp(`(?<![\\d.])(\\d{1,2}(?:\\.\\d{1,3})?)[ \\t]*(?:/[ \\t]*(\\d{1,3}(?:\\.\\d{1,2})?)[ \\t]*)?${G_KEY}(?![\\p{L}])`, 'giu');
const G_BARE = /(?<![\d./])(\d{1,2}\.\d{1,3})[ \t]*\/[ \t]*(10(?:\.0+)?|4(?:\.0+)?|5(?:\.0+)?)(?![\d.])/gu;

function cgpaHit(valueStr: string, scaleStr: string | undefined, start: number, end: number, key: string): ScoreHit {
  const value = parseFloat(valueStr);
  let scale: number;
  let assumedScale = false;
  if (scaleStr !== undefined) scale = parseFloat(scaleStr);
  else if (value > 4) scale = 10;
  else {
    scale = 4;
    assumedScale = true;
  }
  return { score: { kind: 'cgpa', value, scale }, start, end, sgpa: /^s/i.test(key), assumedScale };
}

function findScore(text: string): ScoreHit | null {
  const hits: ScoreHit[] = [];
  for (const re of [P_SYMBOL, P_WORD]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) hits.push({ score: { kind: 'percent', value: parseFloat(m[1]!), scale: 100 }, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, sgpa: false, assumedScale: false });
  }
  G_FWD.lastIndex = 0;
  for (const m of text.matchAll(G_FWD)) hits.push(cgpaHit(m[2]!, m[3], m.index ?? 0, (m.index ?? 0) + m[0].length, m[1]!));
  const fwd = hits.filter((h) => h.score.kind === 'cgpa');
  G_REV.lastIndex = 0;
  for (const m of text.matchAll(G_REV)) {
    const at = m.index ?? 0;
    // "SGPA: 7.9 CGPA: 8.3": the 7.9 belongs to the SGPA label before it, not to the CGPA after it.
    if (fwd.some((h) => at >= h.start && at < h.end)) continue;
    hits.push(cgpaHit(m[1]!, m[2], at, at + m[0].length, m[3]!));
  }
  G_BARE.lastIndex = 0;
  for (const m of text.matchAll(G_BARE)) hits.push(cgpaHit(m[1]!, m[2], m.index ?? 0, (m.index ?? 0) + m[0].length, 'cgpa'));
  const marks = findMarks(text);
  if (marks) hits.push({ score: { kind: 'percent', value: marks.pct, scale: 100 }, start: marks.start, end: marks.end, sgpa: false, assumedScale: false });
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.start - b.start);
  return hits.find((h) => !h.sgpa) ?? hits[0]!;
}

function scoreIssue(h: ScoreHit): boolean {
  const { kind, value, scale } = h.score;
  if (value < 0) return true;
  if (kind === 'percent') return value > 100;
  if (value > scale) return true;
  if (scale !== 4 && scale !== 5 && scale !== 10) return true;
  return h.assumedScale || h.sgpa;
}

// ---------------------------------------------------------------------------------------------
// Years
// ---------------------------------------------------------------------------------------------

interface YearHit {
  start: number | null;
  pass: number | null;
  spans: EvidenceSpan[];
}

const Y = '(?:19[89]\\d|20[0-3]\\d)';
const MON = '(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?,?[ \\t]+|\\d{1,2}[ \\t]*[/.][ \\t]*)?';
const Y_RANGE = new RegExp(`(?<![\\d])(${Y})[ \\t]*(?:-|–|—|to|till|until)[ \\t]*(?:expected[ \\t]*(?:in[ \\t]*|by[ \\t]*)?)?${MON}(${Y}|\\d{2})(?![\\d])`, 'giu');
const Y_PRESENT = new RegExp(`(?<![\\d])(${Y})[ \\t]*(?:-|–|—|to)[ \\t]*(?:present|ongoing|current|continuing|pursuing|till[ \\t]+date|now)\\b`, 'giu');
const APOS = "['\u2018\u2019\u02BC]";
const MON_NAME = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?[ \\t]*';
/** "Jun'22 - May'26": two-digit years are read only after an apostrophe. */
const Y_MON_RANGE = new RegExp(`(?<![\\p{L}\\d])${MON_NAME}${APOS}(\\d{2})[ \\t]*(?:-|–|—|to|till|until)[ \\t]*(?:${MON_NAME})?(?:${APOS}(\\d{2})|(${Y}))(?![\\d])`, 'giu');
const Y_MON_PRESENT = new RegExp(`(?<![\\p{L}\\d])${MON_NAME}${APOS}(\\d{2})[ \\t]*(?:-|–|—|to)[ \\t]*(?:present|ongoing|current|continuing|pursuing|till[ \\t]+date|now)\\b`, 'giu');
const Y_PASS_KEY = new RegExp(`\\b(?:expected|expecting|graduating|batch(?:[ \\t]+of)?|passing(?:[ \\t]+year)?|pass[ \\t-]?out(?:[ \\t]+year)?|year[ \\t]+of[ \\t]+(?:passing|completion|graduation)|completed|completion|graduation)[^\\d\\n]{0,15}${MON}(${Y})(?![\\d])`, 'giu');
const Y_START_KEY = new RegExp(`\\b(?:admitted|admission|joined|enrolled|started|since)[^\\d\\n]{0,15}${MON}(${Y})(?![\\d])`, 'giu');
const Y_SINGLE = new RegExp(`(?<![\\d.])(${Y})(?![\\d%]|\\.\\d)`, 'gu');

function findYears(text: string): YearHit | null {
  Y_PRESENT.lastIndex = 0;
  const pres = Y_PRESENT.exec(text);
  Y_RANGE.lastIndex = 0;
  for (const m of text.matchAll(Y_RANGE)) {
    const start = parseInt(m[1]!, 10);
    const endRaw = m[2]!;
    let end: number;
    if (endRaw.length === 4) end = parseInt(endRaw, 10);
    else {
      end = Math.floor(start / 100) * 100 + parseInt(endRaw, 10);
      if (end < start || end - start > 10) continue;
    }
    const at = m.index ?? 0;
    return { start, pass: end, spans: [{ start: at, end: at + m[0].length }] };
  }
  Y_MON_RANGE.lastIndex = 0;
  for (const m of text.matchAll(Y_MON_RANGE)) {
    const start = 2000 + parseInt(m[1]!, 10);
    const end = m[2] !== undefined ? 2000 + parseInt(m[2], 10) : parseInt(m[3]!, 10);
    if (end < start || end - start > 10) continue;
    const at = m.index ?? 0;
    return { start, pass: end, spans: [{ start: at, end: at + m[0].length }] };
  }
  Y_MON_PRESENT.lastIndex = 0;
  const monPres = Y_MON_PRESENT.exec(text);
  if (monPres && !pres) return { start: 2000 + parseInt(monPres[1]!, 10), pass: null, spans: [{ start: monPres.index, end: monPres.index + monPres[0].length }] };
  if (pres) return { start: parseInt(pres[1]!, 10), pass: null, spans: [{ start: pres.index, end: pres.index + pres[0].length }] };
  const spans: EvidenceSpan[] = [];
  let start: number | null = null;
  let pass: number | null = null;
  Y_START_KEY.lastIndex = 0;
  const sk = Y_START_KEY.exec(text);
  if (sk) {
    start = parseInt(sk[1]!, 10);
    spans.push({ start: sk.index, end: sk.index + sk[0].length });
  }
  Y_PASS_KEY.lastIndex = 0;
  const pk = Y_PASS_KEY.exec(text);
  if (pk) {
    pass = parseInt(pk[1]!, 10);
    spans.push({ start: pk.index, end: pk.index + pk[0].length });
  }
  if (pass === null) {
    Y_SINGLE.lastIndex = 0;
    const singles = [...text.matchAll(Y_SINGLE)].filter((m) => !(sk && m.index === sk.index + sk[0].length - m[0].length));
    const last = singles[singles.length - 1];
    if (last) {
      pass = parseInt(last[1]!, 10);
      spans.push({ start: last.index ?? 0, end: (last.index ?? 0) + last[0].length });
    }
  }
  return start === null && pass === null ? null : { start, pass, spans };
}

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

const MAX_RECORD_LINES = 6;
const RECORD_STOP = /^[^\p{L}\p{N}]*(?:gap|break|backlogs?|active|current|currently|atkt|kt|arrears?|no\s+(?:active\s+|current\s+|standing\s+)?(?:backlogs?|arrears?|atkt|kt)|number\s+of|cleared|history)\b/iu;
const LATERAL = /\blateral(?:[ \t]+entry)?\b|\bLEET\b|\bdirect[ \t]+(?:2nd|second)[ \t]+year\b/i;
const LEVEL_ORDER: EducationLevel[] = ['10th', '12th', 'diploma', 'ug', 'pg'];

interface Rec {
  lines: { start: number; end: number }[];
  hit: LevelHit;
}

function parseRecord(text: string, rec: Rec): { entry: EducationEntry; lateral: boolean } | null {
  const base = rec.lines[0]!.start;
  const last = rec.lines[rec.lines.length - 1]!;
  const firstEnd = rec.lines[0]!.end;
  const recText = text.slice(base, last.end);
  const first = text.slice(base, firstEnd);
  const restStart = rec.lines[1]?.start ?? last.end;
  const rest = text.slice(restStart, last.end);
  const level = rec.hit.level;
  const evidence: EvidenceSpan[] = [{ start: base + rec.hit.start, end: base + rec.hit.end }];

  const score = findScore(first) ? { hit: findScore(first)!, off: base } : findScore(rest) ? { hit: findScore(rest)!, off: restStart } : null;
  const years = findYears(first) ? { hit: findYears(first)!, off: base } : findYears(rest) ? { hit: findYears(rest)!, off: restStart } : null;
  const board = findBoard(recText, level);
  const isDegree = level === 'ug' || level === 'pg' || level === 'diploma';
  const branch = isDegree ? findBranch(first, rest, rec.hit.end, rec.hit.start) : null;

  if (score) evidence.push({ start: score.off + score.hit.start, end: score.off + score.hit.end });
  if (years) for (const s of years.hit.spans) evidence.push({ start: years.off + s.start, end: years.off + s.end });
  if (board) evidence.push({ start: base + board.start, end: base + board.end });

  const startYear = years?.hit.start ?? null;
  const passoutYear = years?.hit.pass ?? null;
  let low = score === null || scoreIssue(score.hit) || passoutYear === null;
  if (startYear !== null && passoutYear !== null) {
    if (passoutYear < startYear) low = true;
    else if (rec.hit.duration !== null) {
      const span = passoutYear - startYear;
      if (span < rec.hit.duration - 1 || span > rec.hit.duration + 3) low = true;
    }
  }
  const confidence: Confidence = low ? 'low' : 'high';
  evidence.sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    entry: { level, board: board?.label ?? null, score: score?.hit.score ?? null, startYear, passoutYear, degree: rec.hit.degree, branch, confidence, evidence },
    lateral: LATERAL.test(recText),
  };
}

function completeness(e: EducationEntry): number {
  return [e.board, e.score, e.startYear, e.passoutYear, e.degree, e.branch].filter((v) => v !== null).length;
}

/** Split a region of text into records, each starting at a line that carries a level token. */
function recordsIn(text: string, from: number, to: number): Rec[] {
  const out: Rec[] = [];
  let cur: Rec | null = null;
  let pos = from;
  while (pos < to) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1 || nl > to) nl = to;
    const line = text.slice(pos, nl);
    if (line.trim().length > 0) {
      const hit = findLevel(line);
      if (hit) {
        cur = { lines: [{ start: pos, end: nl }], hit };
        out.push(cur);
      } else if (RECORD_STOP.test(line)) cur = null;
      else if (cur && cur.lines.length < MAX_RECORD_LINES) cur.lines.push({ start: pos, end: nl });
    }
    pos = nl + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Backlogs
// ---------------------------------------------------------------------------------------------

const BK = '\\b(?:back[ \\t]?logs?|atkts?|kts?|arrears?)\\b';
const NUM = '(\\d{1,2}|nill?|none|zero|no)\\b';
const SEP = '[ \\t]*[:\\-–=]?[ \\t]*';
const re = (s: string) => new RegExp(s, 'iu');
const HISTORY_RES: RegExp[] = [
  re(`${BK}[ \\t]*history${SEP}${NUM}`),
  re(`history[ \\t]+of[ \\t]+${BK}${SEP}${NUM}`),
  re(`\\bno[ \\t]+${BK}[ \\t]+history\\b`),
  re(`\\bno[ \\t]+history[ \\t]+of[ \\t]+${BK}`),
  re(`\\b(?:cleared|previous|past|earlier)[ \\t]+${BK}${SEP}${NUM}`),
  re(`${BK}[ \\t]*cleared${SEP}${NUM}`),
  re(`\\bcleared[ \\t]+(\\d{1,2})[ \\t]+${BK}`),
  re(`\\b(\\d{1,2})[ \\t]+(?:cleared|previous|past)[ \\t]+${BK}`),
  re(`\\b(\\d{1,2})[ \\t]+${BK}[^.;\\n|]{0,30}?\\bcleared\\b`),
];
const ACTIVE_RES: RegExp[] = [
  re(`\\bno[ \\t]+(?:active[ \\t]+|current[ \\t]+|standing[ \\t]+|pending[ \\t]+|live[ \\t]+)?${BK}`),
  re(`\\b(?:active|current|currently|pending|standing|live)[ \\t]+${BK}[ \\t]*(?:count|number)?${SEP}${NUM}`),
  re(`\\b(\\d{1,2})[ \\t]+(?:active|current|pending|standing|live)[ \\t]+${BK}`),
  re(`${BK}[ \\t]*[:\\-–=][ \\t]*${NUM}`),
  re(`(?<!\\bhad[ \\t])\\b(\\d{1,2})[ \\t]+${BK}`),
  re(`\\b(?:zero|nil)[ \\t]+${BK}`),
];

function numOf(raw: string | undefined): number {
  if (raw === undefined) return 0;
  return /^\d/.test(raw) ? parseInt(raw, 10) : 0;
}

/** Active backlogs and backlog history from any "No active backlogs"-style statement, else nulls. */
export function parseBacklogs(text: string): Backlogs {
  const out: Backlogs = { active: null, history: null };
  if (typeof text !== 'string' || text.length === 0) return out;
  for (const rawLine of text.split('\n')) {
    if (rawLine.length > 400 || !/back\s?log|atkt|\bkts?\b|arrear/i.test(rawLine)) continue;
    let line = rawLine;
    for (const r of HISTORY_RES) {
      const m = r.exec(line);
      if (!m) continue;
      if (out.history === null) out.history = numOf(m[1]);
      line = line.slice(0, m.index) + ' '.repeat(m[0].length) + line.slice(m.index + m[0].length);
    }
    if (out.active === null) {
      for (const r of ACTIVE_RES) {
        const m = r.exec(line);
        if (m) {
          out.active = numOf(m[1]);
          break;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Parse the education entries, backlogs and lateral-entry flag from resume text. Reads only the
 * education section(s) when the resume has headings, else the whole text. At most one entry per
 * level (the most complete record wins); entries are ordered 10th, 12th, diploma, ug, pg.
 */
export function parseEducation(text: string, sections?: ResumeSection[]): EducationParse {
  const empty: EducationParse = { entries: [], backlogs: { active: null, history: null }, lateralEntry: false };
  if (typeof text !== 'string' || text.trim().length === 0) return empty;
  const secs = sections ?? detectSections(text);
  const edu = secs.filter((s) => s.kind === 'education');
  const regions = edu.length > 0 ? edu.map((s) => [s.start, s.end] as const) : ([[0, text.length]] as const);

  const best = new Map<EducationLevel, EducationEntry>();
  let lateral = false;
  for (const [from, to] of regions) {
    for (const rec of recordsIn(text, from, to)) {
      const parsed = parseRecord(text, rec);
      if (!parsed) continue;
      const e = parsed.entry;
      if (e.score === null && e.passoutYear === null && e.startYear === null && e.board === null) continue;
      if (parsed.lateral) lateral = true;
      const prev = best.get(e.level);
      if (!prev || completeness(e) > completeness(prev)) best.set(e.level, e);
    }
  }
  const entries = LEVEL_ORDER.flatMap((l) => (best.has(l) ? [best.get(l)!] : []));
  const levels = new Set(entries.map((e) => e.level));
  if (levels.has('diploma') && levels.has('ug') && !levels.has('12th')) lateral = true;
  return { entries, backlogs: parseBacklogs(text), lateralEntry: lateral };
}
