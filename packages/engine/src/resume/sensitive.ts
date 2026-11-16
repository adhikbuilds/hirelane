import type { ExtractMeta, SensitiveFinding, SensitiveKind, Severity } from './types';
import { verhoeffValid } from './verhoeff';
import { normalizeResumeText } from './sections';

/*
 * Sensitive-data detection for resumes (Amendment B section 4). Pure code, no runtime deps.
 *
 * Offsets are UTF-16 indexes into the NFKC-normalised text (see normalizeResumeText).
 * detectSensitive normalises its input itself, and normalising is idempotent, so callers that
 * already hold normalised text get offsets into that same text. Findings NEVER carry the value.
 *
 * ReDoS: every quantifier on free text is bounded ({0,n}), there are no nested unbounded
 * quantifiers, and context windows are capped at 40 characters, so scanning is linear.
 */

export { normalizeResumeText };

const CONTEXT_CHARS = 40;
// \b is ASCII-only in JS, so use explicit lookarounds that also cover Devanagari.
const LB = '(?<![\\p{L}\\p{M}\\p{N}])';
const NOT_LETTER_AFTER = '(?![\\p{L}\\p{M}])';

const AADHAAR_LABEL = /(?<![a-z])(?:aadhaar|aadhar|adhar|uidai|uid|vid)(?![a-z])|आधार/giu;
const NOT_ID_LABEL =
  /\+\s{0,2}91|(?<![a-z])(?:mobile|mob|phone|ph|tel|telephone|contact|cell|whatsapp|call|roll|reg|registration|enrol|enrolment|enrollment|order|invoice|student|employee|emp|application|ref|reference|txn|transaction|ticket|account|policy|ssn)(?![a-z])/giu;
const PAN_LABEL = /(?<![a-z])pan(?![a-z])|permanent\s{1,3}account/iu;

// Groups may be separated by up to three of space, tab, '.', '/', '-' or a line break (wrapped
// text); a contiguous or digit-by-digit spaced form is matched separately.
const AADHAAR_RE = /(?<!\d[ -]?)([2-9]\d{3})[ \t./\n-]{0,3}(\d{4})[ \t./\n-]{0,3}(\d{4})(?![ -]?\d)/g;
const AADHAAR_SPACED_RE = /(?<!\d[ -]?)[2-9](?: ?\d){11}(?![ -]?\d)/g;
const VID_RE = /(?<!\d[ -]?)([2-9]\d{3})[ \t./\n-]{0,3}(\d{4})[ \t./\n-]{0,3}(\d{4})[ \t./\n-]{0,3}(\d{4})(?![ -]?\d)/g;
const MASKED_RE = /(?<![\p{L}\p{N}])(?:[Xx*\u2022\u25CF]{4}[ -]?){2}\d{4}(?!\d)/gu;
const PAN_RE = /(?<![A-Za-z0-9])[A-Za-z]{3}[PCHFATBLJGKpchfatbljgk][A-Za-z][ -]{0,2}[0-9]{4}[ -]{0,2}[A-Za-z](?![A-Za-z0-9])/g;

const SEP = '[\\s:\\-\u2013]{0,6}';
const DATE =
  '(?:\\d{1,4}[\\/.\\-\\s]{1,2}\\d{1,2}[\\/.\\-\\s]{1,2}\\d{2,4}' +
  '|\\d{1,2}(?:st|nd|rd|th)?[\\s\\-]{1,3}(?:of\\s)?[a-z]{3,9}\\.?,?\\s{0,2}\\d{2,4}' +
  '|[a-z]{3,9}\\.?\\s{1,2}\\d{1,2}(?:st|nd|rd|th)?,?\\s{0,2}\\d{2,4})';
const DOB_RE = new RegExp(
  `${LB}(?:date\\s{0,3}of\\s{0,3}birth|birth\\s{0,3}date|d\\.?\\s?o\\.?\\s?b\\.?|born(?:\\s{1,3}on)?|जन्म\\s{0,3}(?:तिथि|तारीख|दिनांक))${NOT_LETTER_AFTER}${SEP}${DATE}(?!\\d)`,
  'giu',
);
const AGE_RES = [
  new RegExp(`${LB}age\\s{0,2}[:\\-\u2013]\\s{0,3}\\d{1,2}(?!\\d)`, 'giu'),
  new RegExp(`${LB}age\\s{1,3}\\d{1,2}\\s{0,2}(?:years?|yrs?)(?![a-z])`, 'giu'),
  new RegExp(`${LB}\\d{1,2}\\s{0,2}(?:years?|yrs?)\\s{1,2}old(?![a-z])`, 'giu'),
];

const NAME = "\\p{L}[\\p{L}\\p{M}.' ]{0,49}";
const HONORIFIC = '(?:(?:mr|mrs|ms|shri|smt|late|dr)\\.?\\s{1,2})?';
const PARENT_RES = [
  new RegExp(`${LB}(?:father|mother|parent|guardian)(?:['\u2019]?s)?\\s{0,2}(?:name)?\\s{0,2}[:\\-\u2013]\\s{0,3}${HONORIFIC}${NAME}`, 'giu'),
  new RegExp(`${LB}name\\s{1,2}of\\s{1,2}(?:the\\s{1,2})?(?:father|mother)\\s{0,2}[:\\-\u2013]?\\s{0,3}${HONORIFIC}${NAME}`, 'giu'),
  new RegExp(`${LB}(?:[sd]\\s?/\\s?o|(?:son|daughter)\\s{1,2}of)${NOT_LETTER_AFTER}${SEP}${HONORIFIC}${NAME}`, 'giu'),
];

const VALUE = '[\\p{L}\\p{M}]{2,25}(?: [\\p{L}\\p{M}]{2,25})?';
const LABEL_RES: { kind: SensitiveKind; re: RegExp }[] = [
  { kind: 'religion', re: new RegExp(`${LB}(?:religion|faith|धर्म)${NOT_LETTER_AFTER}\\s{0,2}[:\\-\u2013]\\s{0,3}${VALUE}`, 'giu') },
  { kind: 'caste', re: new RegExp(`${LB}(?:caste|sub[\\s-]?caste|community|जाति)${NOT_LETTER_AFTER}\\s{0,2}[:\\-\u2013]\\s{0,3}${VALUE}`, 'giu') },
  {
    kind: 'caste',
    re: new RegExp(
      `${LB}category\\s{0,2}[:\\-\u2013]\\s{0,3}(?:general|gen|open|obc(?:[\\s-]?ncl)?|sc|st|ebc|ews|bc|sbc|sebc|nt|vj|pwd|minority)${NOT_LETTER_AFTER}`,
      'giu',
    ),
  },
  { kind: 'marital_status', re: new RegExp(`${LB}(?:marital(?:\\s{1,2}status)?|वैवाहिक(?:\\s{1,2}स्थिति)?)${NOT_LETTER_AFTER}\\s{0,2}[:\\-\u2013]\\s{0,3}${VALUE}`, 'giu') },
];

interface Candidate {
  kind: SensitiveKind;
  start: number;
  end: number;
  severity: Severity;
  pri: number;
}

/** The text just before `start`, limited to the same line unless that line prefix is blank. */
function contextBefore(text: string, start: number): string {
  let w = text.slice(Math.max(0, start - CONTEXT_CHARS), start);
  const nl = w.lastIndexOf('\n');
  if (nl >= 0 && w.slice(nl + 1).trim() !== '') w = w.slice(nl + 1);
  return w;
}

function lastLabelEnd(re: RegExp, window: string): number {
  let end = -1;
  for (const m of window.matchAll(re)) end = (m.index ?? 0) + m[0].length;
  return end;
}

/**
 * Context verdict for an ID-like number. An Aadhaar label earlier in the same 40-character window
 * is an absolute boost (a nearby 'mobile' or 'student' word cannot suppress it) unless digits or a
 * list separator sit between the label and the number (then the label belongs to another number).
 * Suppression applies only when no such label exists.
 */
function idContext(text: string, start: number): 'boost' | 'suppress' | 'none' {
  const w = contextBefore(text, start);
  const boost = lastLabelEnd(AADHAAR_LABEL, w);
  if (boost >= 0 && !/[\d,;|]/.test(w.slice(boost))) return 'boost';
  const sup = lastLabelEnd(NOT_ID_LABEL, w);
  if (sup > boost) return 'suppress';
  return boost >= 0 ? 'boost' : 'none';
}

function trimEnd(text: string, start: number, end: number): number {
  let e = end;
  while (e > start && (text[e - 1] === ' ' || text[e - 1] === '.' || text[e - 1] === "'")) e--;
  return e;
}

/**
 * Find sensitive items in resume text (or a filename / metadata string).
 * Findings are sorted by start and never overlap (zero-length 'image' aside).
 */
export function detectSensitive(input: string, meta?: Pick<ExtractMeta, 'imageCount'>): SensitiveFinding[] {
  const text = normalizeResumeText(input);
  const found: Candidate[] = [];
  const push = (kind: SensitiveKind, start: number, end: number, severity: Severity, pri: number) => found.push({ kind, start, end, severity, pri });

  for (const m of text.matchAll(VID_RE)) {
    const start = m.index ?? 0;
    const digits = m[0].replace(/\D/g, '');
    const ctx = idContext(text, start);
    if (ctx === 'suppress' || text[start - 1] === '+') continue;
    if (ctx === 'boost' || verhoeffValid(digits)) push('vid', start, start + m[0].length, 'high', 0);
  }
  const seenAadhaar = new Set<number>();
  for (const re of [AADHAAR_RE, AADHAAR_SPACED_RE]) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      if (seenAadhaar.has(start)) continue;
      const digits = m[0].replace(/\D/g, '');
      if (digits.length !== 12) continue;
      const ctx = idContext(text, start);
      if (ctx === 'suppress') continue;
      const valid = verhoeffValid(digits);
      // Without a label, accept only a Verhoeff-valid number written in the plain forms.
      if (ctx !== 'boost') {
        if (!valid) continue;
        if (re === AADHAAR_SPACED_RE || !/^[\d -]+$/.test(m[0])) continue;
        if (text[start - 1] === '+') continue;
        if (!/\D/.test(m[0]) && digits.startsWith('91') && /[6-9]/.test(digits[2] ?? '')) continue;
      }
      seenAadhaar.add(start);
      push('aadhaar', start, start + m[0].length, ctx === 'boost' ? (valid ? 'high' : 'low') : 'medium', 1);
    }
  }
  for (const m of text.matchAll(MASKED_RE)) push('aadhaar_masked', m.index ?? 0, (m.index ?? 0) + m[0].length, 'low', 2);
  for (const m of text.matchAll(PAN_RE)) {
    const start = m.index ?? 0;
    const labelled = PAN_LABEL.test(contextBefore(text, start).slice(-20));
    if (m[0] !== m[0].toUpperCase() && !labelled) continue;
    if (/[ -]/.test(m[0]) && !labelled) continue;
    push('pan', start, start + m[0].length, 'high', 3);
  }
  for (const re of [DOB_RE, ...AGE_RES]) {
    for (const m of text.matchAll(re)) push('dob', m.index ?? 0, (m.index ?? 0) + m[0].length, 'medium', 4);
  }
  for (const re of PARENT_RES) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      push('parent_name', start, trimEnd(text, start, start + m[0].length), 'medium', 5);
    }
  }
  for (const { kind, re } of LABEL_RES) {
    for (const m of text.matchAll(re)) push(kind, m.index ?? 0, (m.index ?? 0) + m[0].length, 'medium', 6);
  }

  found.sort((a, b) => a.start - b.start || a.pri - b.pri || b.end - a.end);
  const out: SensitiveFinding[] = [];
  let lastEnd = 0;
  for (const c of found) {
    if (c.start < lastEnd) continue;
    out.push({ kind: c.kind, start: c.start, end: c.end, severity: c.severity });
    lastEnd = c.end;
  }
  if ((meta?.imageCount ?? 0) > 0) out.unshift({ kind: 'image', start: 0, end: 0, severity: 'low' });
  return out;
}

/**
 * Length-preserving mask: every letter/digit inside an Aadhaar, VID or PAN finding becomes 'X';
 * separators stay. Other kinds are flagged, not masked. `text` must be the normalised text the
 * findings were computed on. Out-of-range offsets are clamped.
 */
export function maskSensitive(text: string, findings: readonly SensitiveFinding[]): string {
  const spans = findings
    .filter((f) => f.kind === 'aadhaar' || f.kind === 'vid' || f.kind === 'pan')
    .map((f) => [Math.max(0, f.start), Math.min(text.length, f.end)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let out = '';
  let pos = 0;
  for (const [s, e] of spans) {
    if (e <= pos) continue;
    const from = Math.max(s, pos);
    out += text.slice(pos, from) + text.slice(from, e).replace(/[0-9A-Za-z]/g, 'X');
    pos = e;
  }
  return out + text.slice(pos);
}
