/**
 * Resume normalisers (PRD RP3, E5 validation). Pure, rules-only, no LLM.
 * Dates ("Jun'22", "2022-26", "Pursuing"), marks ("412/500" = 82.4%), score text (percent, CGPA, SGPA) and
 * score validation. Validation output is a "check this" flag for the student; it never changes a verdict.
 */

export interface YearMonth {
  year: number;
  month: number | null;
}
export interface DateRange {
  start: YearMonth | null;
  end: YearMonth | null;
  /** "Pursuing", "Present", "Ongoing": the degree is not final. */
  ongoing: boolean;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const APOS = "['‘’ʼ`´]";
const MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const DASH = '[-‐-―−]';

function fullYear(s: string): number | null {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  if (s.length === 2) return n <= 49 ? 2000 + n : 1900 + n;
  return n >= 1950 && n <= 2099 ? n : null;
}

/** One date: "Jun'22", "June 2022", "06/2022", "2022", "'22". */
export function normalizeDate(raw: string | null | undefined): YearMonth | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFKC').trim();
  if (!s) return null;
  let m = new RegExp(`^${MON_RE}[\\s,]*(?:${APOS}\\s*)?(\\d{4}|\\d{2})$`, 'i').exec(s);
  if (m) {
    const y = fullYear(m[2]!);
    return y === null ? null : { year: y, month: MONTHS[m[1]!.toLowerCase()]! };
  }
  m = /^(0?[1-9]|1[0-2])\s*[/.]\s*(\d{4})$/.exec(s);
  if (m) {
    const y = fullYear(m[2]!);
    return y === null ? null : { year: y, month: parseInt(m[1]!, 10) };
  }
  m = new RegExp(`^${APOS}(\\d{2})$`).exec(s);
  if (m) return { year: fullYear(m[1]!)!, month: null };
  m = /^(\d{4})$/.exec(s);
  if (m) {
    const y = fullYear(m[1]!);
    return y === null ? null : { year: y, month: null };
  }
  return null;
}

const ONGOING_RE = /^(?:pursuing|present|ongoing|current(?:ly)?|continuing|till\s+date|to\s+date|now|expected)$/i;

/** A date range: "2022-26", "Jun'22 - May'26", "2022 - Present", or a bare "Pursuing". */
export function normalizeDateRange(raw: string | null | undefined): DateRange | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFKC').trim();
  if (!s) return null;
  if (ONGOING_RE.test(s)) return { start: null, end: null, ongoing: true };
  const parts = s.split(new RegExp(`\\s*(?:${DASH}+|\\bto\\b)\\s*`, 'i'));
  if (parts.length !== 2) return null;
  const start = normalizeDate(parts[0]);
  if (!start) return null;
  const right = parts[1]!.trim();
  if (ONGOING_RE.test(right)) return { start, end: null, ongoing: true };
  let end = normalizeDate(right);
  // "2022-26": a bare two-digit end year takes the century of the start.
  if (!end && /^\d{2}$/.test(right)) {
    const y = Math.floor(start.year / 100) * 100 + parseInt(right, 10);
    end = { year: y, month: null };
  }
  if (!end) return null;
  if (end.year < start.year || (end.year === start.year && start.month !== null && end.month !== null && end.month < start.month)) return null;
  return { start, end, ongoing: false };
}

export interface Marks {
  obtained: number;
  total: number;
  /** Rounded to 2 decimals. */
  pct: number;
}

const round2 = (n: number) => Math.round(n * 100 + 1e-9) / 100;

export interface MarksHit extends Marks {
  start: number;
  end: number;
}

/** Finds the first "412/500", "412 out of 500" or "1020 / 1200" in the text, with its offsets. Not dates, not CGPAs. */
export function findMarks(text: string): MarksHit | null {
  if (typeof text !== 'string') return null;
  const re = /(?<![\d./])(\d{1,4})[ \t]*(?:\/|out[ \t]+of)[ \t]*(\d{3,4})(?![\d./])/giu;
  for (const m of text.matchAll(re)) {
    const obtained = parseInt(m[1]!, 10);
    const total = parseInt(m[2]!, 10);
    if (obtained <= 0 || total < 100 || total > 3000 || obtained > total) continue;
    // 06/2022 reads as month/year, not marks.
    if (total >= 1990 && total <= 2099 && obtained <= 12) continue;
    const start = m.index ?? 0;
    return { obtained, total, pct: round2((obtained / total) * 100), start, end: start + m[0].length };
  }
  return null;
}

/** "412/500", "412 out of 500", "Marks: 1020 / 1200". Not dates, not CGPAs. */
export function normalizeMarks(raw: string | null | undefined): Marks | null {
  if (typeof raw !== 'string') return null;
  const h = findMarks(raw.normalize('NFKC'));
  return h ? { obtained: h.obtained, total: h.total, pct: h.pct } : null;
}

export type ScoreKind = 'percent' | 'cgpa' | 'sgpa';
export interface ParsedScore {
  kind: ScoreKind;
  value: number;
  scale: number;
  assumedScale: boolean;
}

/** One score as the student wrote it. SGPA/SPI are kept apart from CGPA/CPI. */
export function parseScoreText(raw: string | null | undefined): ParsedScore | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFKC');
  const key = String.raw`(cgpa|sgpa|gpa|cpi|spi|c\.g\.p\.a)`;
  const fwd = new RegExp(String.raw`(?<![\p{L}\d])${key}(?![\p{L}])[ \t]*(?::|-|=|of|is)?[ \t]*(\d{1,2}(?:\.\d{1,3})?)(?:[ \t]*(?:/|out[ \t]+of)[ \t]*(\d{1,2}(?:\.\d+)?))?`, 'iu').exec(s);
  const rev = new RegExp(String.raw`(?<![\d.])(\d{1,2}(?:\.\d{1,3})?)[ \t]*(?:/[ \t]*(\d{1,2}(?:\.\d+)?)[ \t]*)?${key}(?![\p{L}])`, 'iu').exec(s);
  const g = fwd ? { k: fwd[1]!, v: fwd[2]!, sc: fwd[3] } : rev ? { k: rev[3]!, v: rev[1]!, sc: rev[2] } : null;
  if (g) {
    const value = parseFloat(g.v);
    const given = g.sc !== undefined ? parseFloat(g.sc) : undefined;
    const assumedScale = given === undefined && value <= 4;
    return { kind: /^s/i.test(g.k) ? 'sgpa' : 'cgpa', value, scale: given ?? (value > 4 ? 10 : 4), assumedScale };
  }
  const bare = /(?<![\d./])(\d{1,2}\.\d{1,3})[ \t]*\/[ \t]*(10|4|5)(?:\.0+)?(?![\d.])/u.exec(s);
  if (bare) return { kind: 'cgpa', value: parseFloat(bare[1]!), scale: parseInt(bare[2]!, 10), assumedScale: false };
  const marks = normalizeMarks(s);
  if (marks) return { kind: 'percent', value: marks.pct, scale: 100, assumedScale: false };
  const pct = /(?<![\d.])(\d{1,3}(?:\.\d{1,3})?)[ \t]*(?:%|per[ \t]*cent\b)/iu.exec(s);
  if (pct) return { kind: 'percent', value: parseFloat(pct[1]!), scale: 100, assumedScale: false };
  return null;
}

export type ScoreFlagCode = 'out_of_scale' | 'bad_scale' | 'sgpa_not_cgpa' | 'scale_assumed' | 'pct_mismatch';
export interface ScoreFlag {
  code: ScoreFlagCode;
  message: string;
}
export interface ScoreValidation {
  ok: boolean;
  flags: ScoreFlag[];
}
export interface ValidateContext {
  /** The percentage the student stated for the same level. */
  statedPct?: number;
  /** pct = a * cgpa + b. The mismatch check runs only when a usable rule exists. */
  rule?: { a: number; b: number } | null;
}

/** A CGPA this far from its stated percentage is flagged. In percentage points. */
export const PCT_MISMATCH_TOLERANCE = 3;

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function validateScore(score: { kind: ScoreKind; value: number; scale: number; assumedScale?: boolean }, ctx: ValidateContext = {}): ScoreValidation {
  const flags: ScoreFlag[] = [];
  const { kind, value, scale } = score;
  if (!fin(value) || value < 0) {
    flags.push({ code: 'out_of_scale', message: 'This score is not a usable number. Please check it.' });
    return { ok: false, flags };
  }
  if (kind === 'percent') {
    if (value > 100) flags.push({ code: 'out_of_scale', message: `${value}% is above 100%. Please check it.` });
    return { ok: flags.length === 0, flags };
  }
  if (kind === 'sgpa') flags.push({ code: 'sgpa_not_cgpa', message: 'This looks like a semester GPA (SGPA). Please enter your overall CGPA.' });
  if (!fin(scale) || ![4, 5, 10].includes(scale)) flags.push({ code: 'bad_scale', message: `A CGPA out of ${scale} is unusual. Most are out of 4, 5 or 10.` });
  else if (value > scale) flags.push({ code: 'out_of_scale', message: `${value} is above the top of the ${scale}-point scale. Please check it.` });
  if (score.assumedScale) flags.push({ code: 'scale_assumed', message: `The scale was not written, so ${scale} was assumed. Please confirm.` });
  const rule = ctx.rule;
  if (kind === 'cgpa' && fin(ctx.statedPct) && rule && fin(rule.a) && fin(rule.b) && scale === 10 && flags.every((f) => f.code !== 'out_of_scale' && f.code !== 'bad_scale')) {
    const conv = Math.min(100, Math.max(0, rule.a * value + rule.b));
    if (Math.abs(conv - ctx.statedPct) > PCT_MISMATCH_TOLERANCE + 1e-9) {
      flags.push({ code: 'pct_mismatch', message: `${value} CGPA works out to about ${conv.toFixed(1)}% by this rule, but you wrote ${ctx.statedPct}%. Please check both.` });
    }
  }
  return { ok: flags.length === 0, flags };
}
