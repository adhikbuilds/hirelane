/**
 * Task 2.3: salary parsing and normalisation (PLAN 3.1). Rule-only and deterministic.
 * Precedence: structured ATS compensation, then the text parser. An LLM proposal only enters through
 * validateLlmSalary (other module). Unparseable input returns null and is never estimated.
 */
import boundsData from '../data/salary-bounds.json';
import { CURRENCY_EXPONENT, CURRENCY_SYMBOL, ISO_CODES, isIso4217, type Iso4217 } from './currency';
import { EngineInvariantError } from './errors';
import { convertMinor, validateFx, type FxSnapshot } from './fx';
import { evidence, TraceBuilder, type CalculationStep, type Evidence, type Trace } from './trace';
import type { CountryCode, JsonValue } from './types';

export { CURRENCY_EXPONENT, type Iso4217 };
export type { FxSnapshot };

export type PayPeriod = 'hour' | 'day' | 'week' | 'month' | 'year';
export const ANNUAL_FACTOR: Record<PayPeriod, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };

/** Structural mirror of @hirelane/ingest CompensationHint. The engine must not import ingest. */
export interface StructuredComp {
  min: number | null;
  max: number | null;
  currency: string | null;
  interval: 'year' | 'month' | 'week' | 'day' | 'hour' | 'unknown';
  kind: 'salary' | 'ote' | 'other';
  summaryText: string | null;
  source: 'ashby.compensation' | 'lever.salaryRange' | 'greenhouse.pay' | 'jsonld.baseSalary';
}

export interface SalaryContext {
  /** From resolveCountries. Disambiguates a bare '$'. */
  countries?: readonly CountryCode[];
}

export type CurrencyRule = 'iso_code' | 'symbol' | 'symbol_by_country' | 'symbol_default_usd' | 'inr_word' | 'structured';

export interface SalaryParse {
  source: 'ats_structured' | 'text' | 'llm';
  kind: 'base' | 'ote';
  ctc: boolean;
  currency: Iso4217;
  currencyRule: CurrencyRule;
  period: PayPeriod;
  periodRule: 'explicit' | 'structured' | 'lpa_crore' | 'magnitude';
  bound: 'range' | 'single' | 'up_to' | 'from';
  minMinor: number | null;
  maxMinor: number | null;
  confidence: number;
  evidence: Evidence[];
  trace: Trace;
}
/** Confidence below this makes the LLM fallback eligible. */
export const SALARY_LLM_BELOW = 0.7;

// ---------------------------------------------------------------------------------------------
// money formatting (pure; no Intl)

function groupWestern(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  return head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + digits.slice(-3);
}

/** Exact money text from integer minor units: symbol, grouping (Indian for INR) and decimals only when non-zero. */
export function formatMoney(minor: number, currency: Iso4217): string {
  const exp = CURRENCY_EXPONENT[currency];
  const unit = 10 ** exp;
  const whole = Math.floor(minor / unit);
  const frac = minor - whole * unit;
  const digits = String(whole);
  const g = currency === 'INR' ? groupIndian(digits) : groupWestern(digits);
  const f = exp > 0 && frac !== 0 ? '.' + String(frac).padStart(exp, '0') : '';
  return CURRENCY_SYMBOL[currency] + g + f;
}

const PERIOD_SUFFIX: Record<PayPeriod, string> = { hour: '/hr', day: '/day', week: '/wk', month: '/mo', year: '/yr' };

function trimDecimals(x: number, digits: number): string {
  const s = x.toFixed(digits);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

function compactMajor(major: number, currency: Iso4217): { text: string; unit: string } {
  if (currency === 'INR') {
    if (major >= 1e7) return { text: trimDecimals(major / 1e7, 2), unit: ' Cr' };
    if (major >= 1e5) return { text: trimDecimals(major / 1e5, 2), unit: ' L' };
    return { text: groupIndian(String(Math.round(major))), unit: '' };
  }
  if (major >= 1e6) return { text: trimDecimals(major / 1e6, 2), unit: 'M' };
  if (major >= 1e3) return { text: trimDecimals(major / 1e3, 1), unit: 'K' };
  return { text: trimDecimals(major, 2), unit: '' };
}

export interface SalaryFormatInput {
  minMinor: number | null;
  maxMinor: number | null;
  currency: Iso4217;
  period: PayPeriod;
}

/** Short display text, e.g. "₹18–25 L/yr", "$257K–$335K/yr", "$40–$55/hr". Pure and deterministic. */
export function formatSalary(s: SalaryFormatInput): string {
  const { currency, period } = s;
  const exp = CURRENCY_EXPONENT[currency];
  const sym = CURRENCY_SYMBOL[currency];
  const suffix = PERIOD_SUFFIX[period];
  const major = (m: number) => m / 10 ** exp;
  const one = (m: number): { text: string; unit: string } => {
    if (period === 'year') return compactMajor(major(m), currency);
    const t = formatMoney(m, currency).slice(sym.length);
    return { text: t, unit: '' };
  };
  const { minMinor: lo, maxMinor: hi } = s;
  if (lo === null && hi === null) return '';
  if (lo === null) {
    const a = one(hi!);
    return `Up to ${sym}${a.text}${a.unit}${suffix}`;
  }
  if (hi === null) {
    const a = one(lo);
    return `From ${sym}${a.text}${a.unit}${suffix}`;
  }
  const a = one(lo);
  if (lo === hi) return `${sym}${a.text}${a.unit}${suffix}`;
  const b = one(hi);
  if (currency === 'INR' && period === 'year' && a.unit === b.unit && a.unit !== '') return `${sym}${a.text}–${b.text}${a.unit}${suffix}`;
  return `${sym}${a.text}${a.unit}–${sym}${b.text}${b.unit}${suffix}`;
}

// ---------------------------------------------------------------------------------------------
// number parsing

interface Dec {
  n: bigint;
  d: number;
}
interface NumParse {
  ok: boolean;
  dec: Dec | null;
  rule: 'plain' | 'western_grouping' | 'indian_grouping' | 'eu_grouping' | 'decimal' | 'invalid';
}
const BAD: NumParse = { ok: false, dec: null, rule: 'invalid' };
const allDigits = (s: string) => /^\d+$/.test(s);

function parseDecimal(raw: string, hasSuffix: boolean): NumParse {
  const s = raw.replace(/\s+/g, '').replace(/[.,]+$/, '');
  if (s === '' || !/^\d[\d.,]*$/.test(s)) return BAD;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  const dec = (intPart: string, frac: string): Dec => ({ n: BigInt(intPart + frac), d: frac.length });
  if (!hasComma && !hasDot) return { ok: true, dec: dec(s, ''), rule: 'plain' };
  if (hasComma && !hasDot) {
    const parts = s.split(',');
    if (parts.some((p) => p === '' || !allDigits(p))) return BAD;
    const first = parts[0]!;
    const rest = parts.slice(1);
    if (first.length < 1 || first.length > 3) return BAD;
    if (rest.every((p) => p.length === 3)) return { ok: true, dec: dec(parts.join(''), ''), rule: 'western_grouping' };
    const last = rest[rest.length - 1]!;
    const mid = rest.slice(0, -1);
    if (rest.length >= 2 && last.length === 3 && mid.every((p) => p.length === 2) && first.length <= 2) return { ok: true, dec: dec(parts.join(''), ''), rule: 'indian_grouping' };
    return BAD;
  }
  if (hasDot && !hasComma) {
    const parts = s.split('.');
    if (parts.some((p) => p === '' || !allDigits(p))) return BAD;
    if (parts.length === 2) {
      const [i, f] = [parts[0]!, parts[1]!];
      if (!hasSuffix && f.length === 3 && i.length >= 1 && i.length <= 3) return { ok: true, dec: dec(i + f, ''), rule: 'eu_grouping' };
      if (f.length <= 8) return { ok: true, dec: dec(i, f), rule: 'decimal' };
      return BAD;
    }
    const first = parts[0]!;
    if (!hasSuffix && first.length <= 3 && parts.slice(1).every((p) => p.length === 3)) return { ok: true, dec: dec(parts.join(''), ''), rule: 'eu_grouping' };
    return BAD;
  }
  // both separators: the last one is the decimal mark
  if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
    const idx = s.lastIndexOf(',');
    const intPart = s.slice(0, idx);
    const frac = s.slice(idx + 1);
    const groups = intPart.split('.');
    if (!allDigits(frac) || frac.length < 1 || frac.length > 2 || groups.some((g) => !allDigits(g))) return BAD;
    if (groups[0]!.length > 3 || !groups.slice(1).every((g) => g.length === 3)) return BAD;
    return { ok: true, dec: dec(groups.join(''), frac), rule: 'eu_grouping' };
  }
  const idx = s.lastIndexOf('.');
  const intPart = s.slice(0, idx);
  const frac = s.slice(idx + 1);
  if (!allDigits(frac) || frac.length < 1 || frac.length > 8) return BAD;
  const ip = parseDecimal(intPart, true);
  if (!ip.ok || !ip.dec || ip.dec.d !== 0 || !intPart.includes(',')) return BAD;
  return { ok: true, dec: dec(ip.dec.n.toString(), frac), rule: ip.rule === 'indian_grouping' ? 'indian_grouping' : 'western_grouping' };
}

type SuffixKind = 'k' | 'm' | 'b' | 'lakh' | 'crore' | 'lpa';
const SUFFIX_MULT: Record<SuffixKind, bigint> = { k: 1000n, m: 1000000n, b: 1000000000n, lakh: 100000n, crore: 10000000n, lpa: 100000n };
const SUFFIX_RULE: Record<SuffixKind, string> = { k: 'k_suffix', m: 'm_suffix', b: 'm_suffix', lakh: 'lakh', crore: 'crore', lpa: 'lpa' };
const INR_WORD: ReadonlySet<SuffixKind> = new Set<SuffixKind>(['lakh', 'crore', 'lpa']);

interface Suffix {
  kind: SuffixKind;
  text: string;
}

function minorOf(dec: Dec, mult: bigint, currency: Iso4217): bigint {
  const num = dec.n * mult * 10n ** BigInt(CURRENCY_EXPONENT[currency]);
  const den = 10n ** BigInt(dec.d);
  return (2n * num + den) / (2n * den);
}

// ---------------------------------------------------------------------------------------------
// scanning

type SymbolRule = 'symbol' | 'rs_inr' | 'us_dollar_prefix' | 'bare_dollar' | 'iso_code';
interface PreCur {
  code: Iso4217 | null; // null = bare dollar
  rule: SymbolRule;
  start: number;
}
interface Mention {
  /** Start of the currency prefix (or the number when there is none). */
  start: number;
  numStart: number;
  numEnd: number;
  /** End of number + suffix (+ trailing plus). */
  end: number;
  /** End after the consumed trailing currency code and period phrase. */
  fullEnd: number;
  raw: string;
  num: NumParse;
  suffix: Suffix | null;
  pre: PreCur | null;
  postCode: Iso4217 | null;
  period: PayPeriod | null;
}

const SYMBOL_RE = /(US\$|CA\$|AU\$|NZ\$|SG\$|HK\$|(?<![A-Za-z])(?:C\$|A\$|S\$)|\$|£|€|₹|¥|(?<![A-Za-z])Rs\.?)\s?$/;
const SYMBOL_MAP: Record<string, { code: Iso4217 | null; rule: SymbolRule }> = {
  'US$': { code: 'USD', rule: 'us_dollar_prefix' },
  'CA$': { code: 'CAD', rule: 'us_dollar_prefix' },
  'C$': { code: 'CAD', rule: 'us_dollar_prefix' },
  'AU$': { code: 'AUD', rule: 'us_dollar_prefix' },
  'A$': { code: 'AUD', rule: 'us_dollar_prefix' },
  'NZ$': { code: 'NZD', rule: 'us_dollar_prefix' },
  'SG$': { code: 'SGD', rule: 'us_dollar_prefix' },
  'S$': { code: 'SGD', rule: 'us_dollar_prefix' },
  'HK$': { code: 'HKD', rule: 'us_dollar_prefix' },
  $: { code: null, rule: 'bare_dollar' },
  '£': { code: 'GBP', rule: 'symbol' },
  '€': { code: 'EUR', rule: 'symbol' },
  '₹': { code: 'INR', rule: 'symbol' },
  '¥': { code: 'JPY', rule: 'symbol' },
  Rs: { code: 'INR', rule: 'rs_inr' },
  'Rs.': { code: 'INR', rule: 'rs_inr' },
};
const ISO_BEFORE_RE = /(?<![A-Za-z])([A-Z]{3})\s?$/;
const NUM_RE = /(?<![A-Za-z0-9_,])(?<!\d\.)(\d{1,3}(?:[ \u00a0]\d{3})+(?![\d,.])|\d[\d.,]*(?: ,\d{3}(?:,\d{3})*)?)/g;
const SUFFIX_RE = /^(?:(lpa|lakhs?|lacs?|crores?|cr|million|mn|billion|bn)(?![A-Za-z])|\s(lpa|lakhs?|lacs?|crores?|cr|million|mn|billion|bn)(?![A-Za-z])|(k|K|m|M|B)(?![A-Za-z])|(L)(?![A-Za-z]))/i;
const POST_CODE_RE = /^\s*([A-Z]{3})(?![A-Za-z])/;
const PERIOD_RES: { re: RegExp; group: number }[] = [
  { re: /^\s*(?:\/|\\)\s*(hour|hr|h|day|week|wk|month|mo|mth|year|yr|annum)(?![A-Za-z])\.?/i, group: 1 },
  { re: /^\s*(?:per|a|an|each|every)\s+(hour|hr|day|week|wk|month|mo|year|yr|annum)(?![A-Za-z])\.?/i, group: 1 },
  { re: /^\s*(annually|yearly|hourly|monthly|weekly|daily|p\.a\.?|pa)(?![A-Za-z])/i, group: 1 },
];
function periodWord(w: string): PayPeriod {
  const x = w.toLowerCase();
  if (x.startsWith('h')) return 'hour';
  if (x.startsWith('d')) return 'day';
  if (x.startsWith('w')) return 'week';
  if (x.startsWith('m')) return 'month';
  return 'year';
}

function suffixKind(word: string, caseSensitiveForms: boolean): SuffixKind | null {
  const w = word.toLowerCase();
  if (w === 'lpa') return 'lpa';
  if (w.startsWith('lakh') || w.startsWith('lac')) return 'lakh';
  if (w.startsWith('crore') || w === 'cr') return 'crore';
  if (w === 'million' || w === 'mn') return 'm';
  if (w === 'billion' || w === 'bn') return 'b';
  if (w === 'k') return 'k';
  if (w === 'm') return 'm';
  if (caseSensitiveForms && word === 'B') return 'b';
  return null;
}

function scanMentions(text: string): Mention[] {
  const out: Mention[] = [];
  NUM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUM_RE.exec(text)) !== null) {
    const raw = m[1]!.replace(/[.,]+$/, '');
    const numStart = m.index;
    const numEnd = numStart + raw.length;
    NUM_RE.lastIndex = Math.max(NUM_RE.lastIndex, numEnd);
    // suffix
    let end = numEnd;
    let suffix: Suffix | null = null;
    const sm = SUFFIX_RE.exec(text.slice(numEnd, numEnd + 12));
    if (sm) {
      const word = sm[1] ?? sm[2] ?? sm[3] ?? sm[4]!;
      const kind = suffixKind(word, true);
      if (kind) {
        suffix = { kind, text: word };
        end = numEnd + sm[0].length;
      } else if (sm[4]) {
        // 'L' only counts as lakh with an INR prefix; decided below
        suffix = { kind: 'lakh', text: 'L' };
        end = numEnd + sm[0].length;
      }
    }
    if (text[end] === '+') end += 1;
    // prefix currency
    const before = text.slice(Math.max(0, numStart - 14), numStart);
    let pre: PreCur | null = null;
    const symm = SYMBOL_RE.exec(before);
    let preStart = numStart;
    if (symm) {
      const symText = symm[1]!;
      const info = SYMBOL_MAP[symText.replace(/\s+$/, '')] ?? SYMBOL_MAP[symText.replace(/\.$/, '')];
      if (info) {
        const symAbs = numStart - before.length + symm.index;
        pre = { code: info.code, rule: info.rule, start: symAbs };
        preStart = symAbs;
        const rest = before.slice(0, symm.index);
        const im = ISO_BEFORE_RE.exec(rest);
        if (im && isIso4217(im[1]!)) {
          pre = { code: im[1] as Iso4217, rule: 'iso_code', start: numStart - before.length + im.index };
          preStart = pre.start;
        }
      }
    } else {
      const im = ISO_BEFORE_RE.exec(before);
      if (im && isIso4217(im[1]!)) {
        pre = { code: im[1] as Iso4217, rule: 'iso_code', start: numStart - before.length + im.index };
        preStart = pre.start;
      }
    }
    if (suffix?.text === 'L' && !(pre && pre.code === 'INR')) {
      suffix = null;
      end = numEnd + (text[numEnd + 0] === '+' ? 0 : 0);
      if (text[end] === '+') end += 1;
    }
    // post: trailing ISO code and period phrase, in either order
    let cursor = end;
    let postCode: Iso4217 | null = null;
    let period: PayPeriod | null = null;
    for (let i = 0; i < 3; i++) {
      const slice = text.slice(cursor, cursor + 24);
      let progressed = false;
      if (postCode === null) {
        const pc = POST_CODE_RE.exec(slice);
        if (pc && isIso4217(pc[1]!)) {
          postCode = pc[1] as Iso4217;
          cursor += pc[0].length;
          progressed = true;
          continue;
        }
      }
      if (period === null) {
        for (const p of PERIOD_RES) {
          const pm = p.re.exec(slice);
          if (pm) {
            period = periodWord(pm[p.group]!);
            cursor += pm[0].length;
            progressed = true;
            break;
          }
        }
      }
      if (!progressed) break;
    }
    out.push({
      start: preStart,
      numStart,
      numEnd,
      end,
      fullEnd: cursor,
      raw,
      num: parseDecimal(raw, suffix !== null),
      suffix,
      pre,
      postCode,
      period,
    });
  }
  return out;
}

const hasCurrencyEvidence = (m: Mention): boolean => m.pre !== null || m.postCode !== null || (m.suffix !== null && INR_WORD.has(m.suffix.kind));

// ---------------------------------------------------------------------------------------------
// context windows and cue regexes

/** Text before `pos` back to the start of its sentence or line, at most `max` characters. */
function sentenceTail(text: string, pos: number, max: number): { text: string; offset: number } {
  const from = Math.max(0, pos - max);
  let s = text.slice(from, pos);
  let cut = 0;
  const re = /(?<![A-Z])[.!?](?=\s)|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) cut = m.index + m[0].length;
  s = s.slice(cut);
  return { text: s, offset: from + cut };
}

/** Text after `pos` up to the first clause break, at most `max` characters. */
function clauseAfter(text: string, pos: number, max: number): string {
  const s = text.slice(pos, pos + max);
  const m = /[.;,()+\n]|\s-\s|\s[–—]\s/.exec(s);
  return m ? s.slice(0, m.index) : s;
}

const WORD = "(?!(?:plus|with|or|including|not|excluding|exclusive|inclusive|before|without|in addition)\\b)[\\w'’/&-]+";
const afterRe = (kw: string): RegExp => new RegExp(`^\\s*(?:(?:in|of|for)\\s+)?(?:${WORD}\\s+){0,4}?(?:${kw})\\b`, 'i');
const beforeRe = (kw: string): RegExp => new RegExp(`\\b(?:${kw})\\b[^$£€₹\\d]{0,32}$`, 'i');

const FUNDING_KW =
  'raised|raise[sd]?|raising|series\\s[a-f]|valuation|valued|ARR|MRR|run[- ]rate|revenues?|funding|funded|backed|investments?|investors?|IPO|turnover|quotas?|revenue targets?|deal size|deals?|bookings|pipeline|GMV|spend|spending|portfolio|book of business|AUM|market cap|capital|seed round|round|loans?|loan offerings|ticket size|contracts?|transactions?';
const BENEFIT_KW =
  'family planning|fertility|adoption|child ?care|wellness|fitness|gym|tuition|commuter|home office|therapy|mental health|learning|professional development|stipends?|allowances?|reimbursements?|reimbursed|match|matching|matches|bonus(?:es)?|sign-?on|signing|relocation|referral|budgets?|HRA|insurance|coverage|deductible|credits?|discounts?|subsid\\w+|lunch|donations?|per diem|per person|per employee|perks?';
const EQUITY_KW = 'equity|RSUs?|stock(?: options?)?|options|shares|ESPP|warrants?';

const FUNDING_BEFORE = beforeRe(FUNDING_KW);
const FUNDING_AFTER = afterRe(FUNDING_KW + '|in capital|in annualized\\s+\\w+');
const BENEFIT_BEFORE = beforeRe(BENEFIT_KW);
const BENEFIT_AFTER = afterRe(BENEFIT_KW + '|per person|per employee');
const EQUITY_BEFORE = beforeRe(EQUITY_KW);
const EQUITY_AFTER = afterRe(EQUITY_KW);

const OTE_RE = /\b(?:OTEs?|on[- ]target(?:\s+earnings)?|total target (?:compensation|cash|pay)|target total (?:compensation|cash)|TTC)\b/gi;
const BASE_RE = /\bbase\s+(?:salary|pay|compensation|range|rate)|\bsalary\b|\bbase\b/gi;
const OTE_AFTER_RE = /^\s*(?:[A-Z]{3}\b\s*)?(?:OTE|on[- ]target)/i;
const PAY_CUE_RE = /\b(?:salary|salaries|compensation|pay|paid|base|OTE|CTC|wage|wages|rate|package|earnings|income|remuneration|range|starting at|up to|minimum|total target|target total)\b/i;
const UP_TO_RE = /\b(?:up\s?to|as high as|maximum(?: of)?|max\.?)\s*[:\-]?\s*$/i;
const FROM_RE = /\b(?:from|starting (?:at|from)|starts? at|minimum(?: of)?|at least|beginning at)\s*[:\-]?\s*$/i;
const BETWEEN_RE = /\bbetween\s*$/i;
const PRE_PERIOD_RE = /\b(per\s+(?:year|annum|hour|hr|month|week|day)|annual(?:ly)?|yearly|hourly|monthly|weekly|daily)\b[^$£€₹\d]{0,30}$/i;
const CTC_RE = /\bCTC\b/i;

const LOCAL_COUNTRY: { code: Iso4217; country: string; re: RegExp }[] = [
  { code: 'CAD', country: 'CA', re: /\b(?:CAN|Canada|Canadian)\b/g },
  { code: 'AUD', country: 'AU', re: /\b(?:AUS|Australia|Australian)\b/g },
  { code: 'SGD', country: 'SG', re: /\b(?:SGP|Singapore)\b/g },
  { code: 'NZD', country: 'NZ', re: /\b(?:New Zealand)\b/g },
  { code: 'USD', country: 'US', re: /\b(?:USA|US|U\.S\.A?\.?|United States)\b/g },
];
const COUNTRY_OF: Partial<Record<Iso4217, string>> = { USD: 'US', CAD: 'CA', AUD: 'AU', SGD: 'SG', NZD: 'NZ', GBP: 'GB', EUR: 'EU', INR: 'IN', HKD: 'HK', JPY: 'JP' };
const DOLLAR_BY_COUNTRY: Partial<Record<string, Iso4217>> = { CA: 'CAD', AU: 'AUD', SG: 'SGD', NZ: 'NZD', HK: 'HKD' };

function lastMatchIndex(re: RegExp, s: string): number {
  re.lastIndex = 0;
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    idx = m.index;
    if (m[0].length === 0) re.lastIndex++;
  }
  return idx;
}

function localDollar(window: string): Iso4217 | null {
  let best: { idx: number; code: Iso4217 } | null = null;
  for (const l of LOCAL_COUNTRY) {
    const idx = lastMatchIndex(l.re, window);
    if (idx >= 0 && (!best || idx > best.idx)) best = { idx, code: l.code };
  }
  return best ? best.code : null;
}

// ---------------------------------------------------------------------------------------------
// statements

type Bound = SalaryParse['bound'];
interface Statement {
  start: number;
  end: number;
  a: Mention;
  b: Mention | null;
  currency: Iso4217;
  currencyRule: CurrencyRule;
  currencyStepRule: string;
  period: PayPeriod;
  periodRule: SalaryParse['periodRule'];
  bound: Bound;
  rangeRule: string;
  minMinor: bigint | null;
  maxMinor: bigint | null;
  kind: 'base' | 'ote';
  ctc: boolean;
  confidence: number;
  payCue: boolean;
  numRules: string[];
  swapped: boolean;
  nearbyCountry: string | null;
}

interface Analysis {
  statements: Statement[];
  steps: CalculationStep[]; // reject and scan steps in document order
}

const boundsFor = (c: Iso4217): [bigint, bigint] => {
  const b = (boundsData.annual as Record<string, number[]>)[c]!;
  const unit = 10n ** BigInt(CURRENCY_EXPONENT[c]);
  return [BigInt(b[0]!) * unit, BigInt(b[1]!) * unit];
};

const MAX_REJECT_STEPS = 24;

function analyse(text: string, ctx: SalaryContext | undefined): Analysis {
  const tb = new TraceBuilder('salary');
  let rejects = 0;
  const reject = (ruleId: string, label: string, start: number, end: number, inputs: { [k: string]: JsonValue } = {}): void => {
    if (rejects >= MAX_REJECT_STEPS) return;
    rejects++;
    tb.step({ ruleId, op: 'reject', label, inputs, output: null, evidence: [evidence('description', text, start, end)] });
  };

  // 401(k) never reads as pay
  const k401 = /\b401\s?(?:\(\s?k\s?\)|k\b)/gi;
  let km: RegExpExecArray | null;
  while ((km = k401.exec(text)) !== null) reject('salary.reject.401k', `"${km[0]}" is a retirement plan, not pay`, km.index, km.index + km[0].length);

  const mentions = scanMentions(text);
  const used = new Set<number>();
  const statements: Statement[] = [];
  let numericRejects = 0;

  for (let i = 0; i < mentions.length; i++) {
    if (used.has(i)) continue;
    const a = mentions[i]!;
    let b: Mention | null = null;
    const nxt = mentions[i + 1];
    if (nxt) {
      const gap = text.slice(a.fullEnd, nxt.start);
      const sepOk = /^\s*(?:-|–|—|~|to|until|through)\s*$/i.test(gap) || (/^\s*and\s*$/i.test(gap) && BETWEEN_RE.test(text.slice(Math.max(0, a.start - 14), a.start)));
      if (sepOk && (hasCurrencyEvidence(a) || hasCurrencyEvidence(nxt))) b = nxt;
    }
    if (!b && !hasCurrencyEvidence(a)) {
      if (numericRejects < 6) {
        const after = text.slice(a.end, a.end + 24);
        const rule = /^\s*%/.test(after)
          ? 'percent'
          : /^\s*\+?\s*(?:years?|yrs?)(?![A-Za-z])/i.test(after)
            ? 'years'
            : /^\s*\+?\s*(?:people|persons?|engineers?|employees?|customers?|users?|members?|developers|clients|reps|associates|agents|offices|countries|cities)(?![A-Za-z])/i.test(after)
              ? 'team_size'
              : null;
        if (rule && a.suffix?.text !== 'L' && !/^401/.test(a.raw)) {
          numericRejects++;
          reject(`salary.reject.${rule}`, `"${text.slice(a.numStart, a.end)}" is a ${rule === 'team_size' ? 'head count' : rule === 'years' ? 'number of years' : 'percentage'}, not pay`, a.numStart, a.fullEnd);
        }
      }
      continue;
    }
    used.add(i);
    if (b) used.add(i + 1);
    const lastM = b ?? a;
    const start = a.start;
    const end = lastM.fullEnd;
    const span = text.slice(start, end);

    // ---- numbers
    if (!a.num.ok || (b && !b.num.ok)) {
      reject('salary.reject.grouping', `"${span}" has invalid digit grouping`, start, end, { text: span });
      continue;
    }
    // ---- comparator
    const lead = text.slice(Math.max(0, start - 3), start).replace(/\s+$/, '');
    if (/[<>≥≤]$/.test(lead)) {
      reject('salary.reject.comparator', `"${span}" is a threshold, not a pay figure`, start, end);
      continue;
    }

    // ---- neighbour words
    const tail = sentenceTail(text, start, 45);
    const after = clauseAfter(text, end, 48);
    const family: [string, RegExp, RegExp, string][] = [
      ['funding', FUNDING_BEFORE, FUNDING_AFTER, 'company or deal size'],
      ['benefit', BENEFIT_BEFORE, BENEFIT_AFTER, 'a benefit or allowance'],
      ['equity', EQUITY_BEFORE, EQUITY_AFTER, 'equity'],
    ];
    let rejected = false;
    for (const [name, bre, are, what] of family) {
      const hitB = bre.exec(tail.text);
      const hitA = hitB ? null : are.exec(after);
      const hit = hitB ?? hitA;
      if (hit) {
        const evStart = hitB ? tail.offset + hitB.index : end;
        const evEnd = hitB ? start : end + hit[0].length;
        reject(`salary.reject.${name}`, `"${span}" is ${what} ("${hit[0].trim()}"), not pay`, Math.min(evStart, start), Math.max(evEnd, end), { amount: span });
        rejected = true;
        break;
      }
    }
    if (rejected) continue;

    // ---- number values, suffix inheritance
    const aSuf = a.suffix;
    const bSuf = b?.suffix ?? null;
    const small = (m: Mention): boolean => !!m.num.dec && m.num.dec.n < 1000n * 10n ** BigInt(m.num.dec.d);
    const effSuffix = (m: Mention, other: Mention | null): Suffix | null => {
      if (m.suffix) return m.suffix;
      const o = other?.suffix ?? null;
      if (o && small(m) && o.kind !== 'b') return o;
      return null;
    };
    const sufA = effSuffix(a, b);
    const sufB = b ? effSuffix(b, a) : null;
    void aSuf;
    void bSuf;

    // ---- currency
    const inrWord = (sufA && INR_WORD.has(sufA.kind)) || (sufB && INR_WORD.has(sufB.kind)) || false;
    const explicitIso = [b?.postCode, a.postCode].find((c) => !!c) ?? [a.pre, b?.pre].find((p) => p && p.rule === 'iso_code')?.code ?? null;
    const symPre = [a.pre, b?.pre].find((p) => p && p.rule !== 'iso_code') ?? null;
    const anyPre = [a.pre, b?.pre].find((p) => !!p) ?? null;
    let currency: Iso4217;
    let currencyRule: CurrencyRule;
    let currencyStepRule: string;
    let confCap = 0.95;
    const nearWindow = text.slice(Math.max(0, tail.offset - 15), start) + ' ' + text.slice(end, end + 20);
    const countryNear = (): string | null => {
      const code = localDollar(nearWindow);
      return code ? COUNTRY_OF[code] ?? null : null;
    };
    if (explicitIso) {
      currency = explicitIso;
      currencyRule = 'iso_code';
      currencyStepRule = 'salary.currency.iso_code';
    } else if (anyPre && anyPre.code === null) {
      const local = localDollar(tail.text + ' ' + text.slice(end, end + 12));
      const fromCtx = ((): Iso4217 | null => {
        const cs = ctx?.countries ?? [];
        if (cs.includes('US')) return 'USD';
        for (const c of cs) {
          const d = DOLLAR_BY_COUNTRY[c];
          if (d) return d;
        }
        return null;
      })();
      const by = local ?? fromCtx;
      if (by) {
        currency = by;
        currencyRule = 'symbol_by_country';
        currencyStepRule = 'salary.currency.symbol_by_country';
        confCap = Math.min(confCap, 0.9);
      } else {
        currency = 'USD';
        currencyRule = 'symbol_default_usd';
        currencyStepRule = 'salary.currency.symbol_default_usd';
        confCap = Math.min(confCap, 0.8);
      }
    } else if (symPre && symPre.code) {
      currency = symPre.code;
      currencyRule = 'symbol';
      currencyStepRule = symPre.rule === 'rs_inr' ? 'salary.currency.rs_inr' : symPre.rule === 'us_dollar_prefix' ? 'salary.currency.us_dollar_prefix' : 'salary.currency.symbol';
    } else if (inrWord) {
      currency = 'INR';
      currencyRule = 'inr_word';
      currencyStepRule = 'salary.currency.inr_word';
    } else {
      continue;
    }

    // ---- values
    const mult = (s: Suffix | null): bigint => (s ? SUFFIX_MULT[s.kind] : 1n);
    let lo = minorOf(a.num.dec!, mult(sufA), currency);
    let hi = b ? minorOf(b.num.dec!, mult(sufB), currency) : lo;
    let swapped = false;
    if (b && lo > hi) {
      [lo, hi] = [hi, lo];
      swapped = true;
    }
    if (lo === 0n || hi === 0n) {
      reject('salary.reject.zero', `"${span}" is zero, not a pay figure`, start, end);
      continue;
    }

    // ---- bound
    let bound: Bound = b ? 'range' : 'single';
    let rangeRule = 'salary.range.single';
    const lead2 = text.slice(Math.max(0, start - 28), start);
    if (b) rangeRule = 'salary.range.dash';
    else if (UP_TO_RE.test(lead2)) {
      bound = 'up_to';
      rangeRule = 'salary.range.up_to';
    } else if (FROM_RE.test(lead2)) {
      bound = 'from';
      rangeRule = 'salary.range.from';
    }
    let minMinor: bigint | null = lo;
    let maxMinor: bigint | null = hi;
    if (bound === 'up_to') minMinor = null;
    if (bound === 'from') maxMinor = null;

    // ---- period
    const exp = CURRENCY_EXPONENT[currency];
    const ref = (bound === 'from' ? lo : hi);
    const [pA, pB] = [a.period, b?.period ?? null];
    const explicitAfter = pB ?? pA;
    const preP = PRE_PERIOD_RE.exec(tail.text);
    const preCtxPeriod = preP ? periodWord(preP[1]!.replace(/^per\s+/i, '')) : null;
    let period: PayPeriod;
    let periodRule: SalaryParse['periodRule'];
    const lpaLike = (sufA && INR_WORD.has(sufA.kind)) || (sufB && INR_WORD.has(sufB.kind));
    const payCue = PAY_CUE_RE.test(tail.text.slice(-60));
    const unitMajor = (n: number): bigint => BigInt(n) * 10n ** BigInt(exp);
    if (explicitAfter) {
      period = explicitAfter;
      periodRule = 'explicit';
    } else if (preCtxPeriod) {
      period = preCtxPeriod;
      periodRule = 'explicit';
    } else if (lpaLike) {
      period = 'year';
      periodRule = 'lpa_crore';
    } else {
      periodRule = 'magnitude';
      if (currency === 'INR') period = ref < unitMajor(300000) ? 'month' : 'year';
      else if (currency === 'JPY' || currency === 'KRW') {
        if (ref >= unitMajor(1000000)) period = 'year';
        else {
          reject('salary.period.ambiguous', `"${span}" has no period and its size does not say which`, start, end);
          continue;
        }
      } else if (ref >= unitMajor(1000)) period = 'year';
      else if (ref < unitMajor(300)) period = 'hour';
      else {
        reject('salary.period.ambiguous', `"${span}" has no period and its size does not say which`, start, end);
        continue;
      }
    }
    if (periodRule === 'magnitude') confCap = Math.min(confCap, 0.6);
    if (bound === 'single' || bound === 'up_to' || bound === 'from') confCap = Math.min(confCap, 0.9);

    // ---- single-amount evidence of pay
    const salaryWord = !!lpaLike || a.period !== null || a.pre?.rule === 'rs_inr';
    const oteAfterHit = OTE_AFTER_RE.test(text.slice(end, end + 24));
    if (!b && bound === 'single' && !(a.period || payCue || lpaLike || oteAfterHit || preCtxPeriod)) {
      reject('salary.reject.no_pay_cue', `"${span}" is a lone amount with no pay wording or period`, start, end);
      continue;
    }
    if (!b && bound !== 'single' && !(a.period || payCue || lpaLike || preCtxPeriod)) {
      reject('salary.reject.no_pay_cue', `"${span}" is a lone amount with no pay wording or period`, start, end);
      continue;
    }
    void salaryWord;

    // ---- plausibility
    const factor = BigInt(ANNUAL_FACTOR[period]);
    const [bLo, bHi] = boundsFor(currency);
    const annLo = (minMinor ?? maxMinor!) * factor;
    const annHi = (maxMinor ?? minMinor!) * factor;
    if (annLo < bLo || annHi > bHi || annHi < bLo || annLo > bHi) {
      reject('salary.plausible.annual_range', `"${span}" is outside the plausible annual range for ${currency}`, start, end, { currency, period });
      continue;
    }

    // ---- kind and ctc
    const beforeWin = sentenceTail(text, start, 90).text;
    const oteIdx = lastMatchIndex(OTE_RE, beforeWin);
    const baseIdx = lastMatchIndex(BASE_RE, beforeWin);
    const kind: 'base' | 'ote' = oteAfterHit || (oteIdx >= 0 && oteIdx > baseIdx) ? 'ote' : 'base';
    const ctc = CTC_RE.test(text.slice(Math.max(0, start - 40), end + 25));

    const numRules = [
      ...new Set([
        a.num.rule,
        ...(b ? [b.num.rule] : []),
        ...(sufA ? [SUFFIX_RULE[sufA.kind]] : []),
        ...(sufB ? [SUFFIX_RULE[sufB.kind]] : []),
      ]),
    ].filter((r) => r !== 'invalid');

    statements.push({
      start, end, a, b, currency, currencyRule, currencyStepRule, period, periodRule, bound, rangeRule,
      minMinor, maxMinor, kind, ctc, confidence: confCap, payCue, numRules, swapped,
      nearbyCountry: countryNear() ?? (COUNTRY_OF[currency] ?? null),
    });
  }
  return { statements, steps: tb.steps.map((s) => ({ ...s })) };
}

// ---------------------------------------------------------------------------------------------
// public: salaryCues

const CUE_WORD_RE = /\b(?:salary|salaries|compensation|base pay|pay range|pay rate|hourly rate|OTE|on[- ]target earnings|CTC|LPA|remuneration|wage|wages)\b/gi;

/**
 * `salary_stated` is true only when an amount exists: a parse with a min or max, or an ATS structured
 * block with a positive min or max. Cue words alone ("competitive compensation") never count.
 */
export function isSalaryStated(
  parse: { minMinor: number | null; maxMinor: number | null } | null | undefined,
  structured: { min: number | null; max: number | null } | null | undefined,
): boolean {
  const pos = (n: number | null | undefined): boolean => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (parse && (pos(parse.minMinor) || pos(parse.maxMinor))) return true;
  return !!structured && (pos(structured.min) || pos(structured.max));
}

/** Spans of salary cue words and currency amounts. Diagnostic only (coverage ceiling and LLM gating). */
export function salaryCues(text: string): Evidence[] {
  const spans: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  CUE_WORD_RE.lastIndex = 0;
  while ((m = CUE_WORD_RE.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length });
  for (const mm of scanMentions(text)) {
    if (hasCurrencyEvidence(mm) && mm.num.ok) spans.push({ start: mm.start, end: mm.fullEnd });
  }
  spans.sort((x, y) => x.start - y.start || x.end - y.end);
  const out: Evidence[] = [];
  for (const s of spans) {
    if (out.length >= 50) break;
    out.push(evidence('description', text, s.start, s.end));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// trace assembly for text statements

function money(minor: bigint | null, currency: Iso4217): string {
  return minor === null ? '' : formatMoney(Number(minor), currency);
}

function statementSteps(s: Statement, text: string, tb: TraceBuilder): void {
  const span = text.slice(s.start, s.end);
  const ev = [evidence('description', text, s.start, s.end)];
  const numText = text.slice(s.a.numStart, (s.b ?? s.a).end);
  tb.step({
    ruleId: `salary.num.${s.numRules.find((r) => ['lpa', 'lakh', 'crore', 'k_suffix', 'm_suffix'].includes(r)) ?? s.numRules[0] ?? 'plain'}`,
    op: 'parse',
    label: `Read ${numText.trim()} as ${s.minMinor !== null ? money(s.minMinor, s.currency) : ''}${s.minMinor !== null && s.maxMinor !== null && s.minMinor !== s.maxMinor ? '–' : ''}${s.maxMinor !== null && s.maxMinor !== s.minMinor ? money(s.maxMinor, s.currency) : ''}`,
    inputs: { text: numText, rules: s.numRules },
    output: { minMinor: s.minMinor === null ? null : Number(s.minMinor), maxMinor: s.maxMinor === null ? null : Number(s.maxMinor) },
    evidence: ev,
  });
  tb.step({
    ruleId: s.currencyStepRule,
    op: 'detect',
    label: `Currency ${s.currency} (${s.currencyRule.replace(/_/g, ' ')})`,
    inputs: { rule: s.currencyRule },
    output: s.currency,
    evidence: ev,
  });
  tb.step({
    ruleId: `salary.period.${s.periodRule === 'lpa_crore' ? 'lpa_crore' : s.periodRule}`,
    op: 'detect',
    label: `Period ${s.period} (${s.periodRule.replace(/_/g, ' ')})`,
    inputs: { rule: s.periodRule },
    output: s.period,
    evidence: ev,
  });
  tb.step({ ruleId: s.rangeRule, op: 'parse', label: `Bound ${s.bound.replace('_', ' ')}${s.swapped ? ' (bounds were reversed and swapped)' : ''}`, inputs: { bound: s.bound, swapped: s.swapped }, output: s.bound, evidence: ev });
  if (s.kind === 'ote') tb.step({ ruleId: 'salary.kind.ote', op: 'classify', label: 'Labelled on-target earnings; kept separate from base pay', inputs: {}, output: 'ote', evidence: ev });
  if (s.ctc) tb.step({ ruleId: 'salary.kind.ctc', op: 'classify', label: 'Indian CTC wording present', inputs: {}, output: true, evidence: ev });
  tb.step({ ruleId: 'salary.plausible.annual_range', op: 'validate', label: `Annualised amount is plausible for ${s.currency}`, inputs: { currency: s.currency, span }, output: true, evidence: ev });
}

// ---------------------------------------------------------------------------------------------
// structured compensation

function structuredPeriod(st: StructuredComp, text: string, ctx: SalaryContext | undefined): { period: PayPeriod; from: 'interval' | 'summary' | 'text' } | null {
  if (st.interval !== 'unknown') return { period: st.interval, from: 'interval' };
  const explicit = (src: string): PayPeriod | null => {
    const hit = analyse(src, ctx).statements.find((s) => s.periodRule === 'explicit' && s.kind === 'base');
    return hit ? hit.period : null;
  };
  if (st.summaryText) {
    const p = explicit(st.summaryText);
    if (p) return { period: p, from: 'summary' };
  }
  const p = explicit(text);
  return p ? { period: p, from: 'text' } : null;
}

function majorToMinor(x: number, currency: Iso4217): bigint {
  // exact decimal rounding half up, via the shortest decimal string of the double
  const s = String(x);
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(s);
  if (!m) return BigInt(Math.round(x * 10 ** CURRENCY_EXPONENT[currency]));
  let digits = (m[1] ?? '') + (m[2] ?? '');
  let scale = (m[2] ?? '').length - Number(m[3] ?? 0);
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  }
  return minorOf({ n: BigInt(digits), d: scale }, 1n, currency);
}

const toSafe = (v: bigint, what: string): number => {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new EngineInvariantError('salary.overflow', `${what} exceeds the safe integer range`);
  return Number(v);
};

function tryStructured(text: string, st: StructuredComp, ctx: SalaryContext | undefined, tb: TraceBuilder): SalaryParse | null {
  const path = st.source;
  const sev = (quote: string): Evidence => ({ source: 'structured', start: 0, end: 0, quote: quote.slice(0, 160), ...(quote.length > 160 ? { quoteTruncated: true as const } : {}), path });
  const cur = (st.currency ?? '').trim().toUpperCase();
  const quote = st.summaryText ?? `${st.min ?? ''}-${st.max ?? ''} ${cur} ${st.interval}`;
  if (cur === '') {
    tb.step({ ruleId: 'salary.structured.currency_missing', op: 'reject', label: 'Structured compensation has no currency; using text instead', inputs: { source: st.source }, output: null, evidence: [sev(quote)] });
    return null;
  }
  if (!isIso4217(cur)) {
    tb.step({ ruleId: 'salary.currency.unsupported', op: 'reject', label: `Currency ${cur} is not supported; using text instead`, inputs: { currency: cur }, output: null, evidence: [sev(quote)] });
    return null;
  }
  const pos = (x: number | null): number | null => (x !== null && Number.isFinite(x) && x > 0 ? x : null);
  let min = pos(st.min);
  let max = pos(st.max);
  if (min === null && max === null) {
    tb.step({ ruleId: 'salary.structured.empty', op: 'reject', label: 'Structured compensation has no positive figure; using text instead', inputs: { source: st.source }, output: null, evidence: [sev(quote)] });
    return null;
  }
  if (st.kind === 'other') {
    tb.step({ ruleId: 'salary.structured.kind_other', op: 'reject', label: 'Structured compensation is neither salary nor OTE; using text instead', inputs: { source: st.source }, output: null, evidence: [sev(quote)] });
    return null;
  }
  const per = structuredPeriod(st, text, ctx);
  if (!per) {
    tb.step({ ruleId: 'salary.structured.period_unknown', op: 'reject', label: 'Structured compensation does not say per what period; dropped', inputs: { source: st.source }, output: null, evidence: [sev(quote)] });
    return null;
  }
  let swapped = false;
  if (min !== null && max !== null && min > max) {
    [min, max] = [max, min];
    swapped = true;
  }
  const minMinor = min === null ? null : toSafe(majorToMinor(min, cur), 'minimum');
  const maxMinor = max === null ? null : toSafe(majorToMinor(max, cur), 'maximum');
  const bound: Bound = minMinor === null ? 'up_to' : maxMinor === null ? 'from' : minMinor === maxMinor ? 'single' : 'range';
  tb.step({
    ruleId: 'salary.structured.use',
    op: 'select',
    label: `Using structured compensation from ${st.source}: ${formatSalary({ minMinor, maxMinor, currency: cur, period: per.period })}`,
    inputs: { source: st.source, currency: cur, interval: st.interval, resolvedFrom: per.from, kind: st.kind },
    output: { minMinor, maxMinor, period: per.period },
    evidence: [sev(quote)],
  });
  if (swapped) tb.step({ ruleId: 'salary.structured.swap', op: 'merge', label: 'Minimum and maximum were reversed and swapped', inputs: {}, output: true, evidence: [sev(quote)] });
  return {
    source: 'ats_structured',
    kind: st.kind === 'ote' ? 'ote' : 'base',
    ctc: false,
    currency: cur,
    currencyRule: 'structured',
    period: per.period,
    periodRule: 'structured',
    bound,
    minMinor,
    maxMinor,
    confidence: 1,
    evidence: [sev(quote)],
    trace: undefined as unknown as Trace,
  };
}

// ---------------------------------------------------------------------------------------------
// parseSalary

export interface SalaryTraced {
  parse: SalaryParse | null;
  trace: Trace;
}

/** Same as parseSalary, but also returns the trace when the result is null (why nothing passed). */
export function parseSalaryTraced(text: string, structured?: StructuredComp | null, ctx?: SalaryContext): SalaryTraced {
  const tb = new TraceBuilder('salary');

  if (structured) {
    const parsed = tryStructured(text, structured, ctx, tb);
    if (parsed) {
      const trace = tb.build('value');
      return { parse: { ...parsed, trace }, trace };
    }
  }

  const an = analyse(text, ctx);
  tb.append(an.steps);
  const base = an.statements.filter((s) => s.kind === 'base');
  const pool = base.length > 0 ? base : an.statements;
  if (pool.length === 0) {
    const trace = tb.build('null');
    return { parse: null, trace };
  }
  let chosen = pool[0]!;
  let rule = base.length > 0 ? 'salary.select.first_base' : 'salary.select.first_ote';
  const want = ctx?.countries?.[0];
  if (want) {
    const m = pool.find((s) => s.nearbyCountry === want);
    if (m) {
      chosen = m;
      rule = 'salary.select.country_match';
    }
  }
  if (an.statements.length > 1) {
    tb.step({
      ruleId: rule,
      op: 'select',
      label: `${an.statements.length} salary statements passed; using the ${rule === 'salary.select.country_match' ? `one for ${want}` : base.length > 0 ? 'first base statement' : 'first OTE statement'}`,
      inputs: { candidates: an.statements.length },
      output: { start: chosen.start, end: chosen.end },
      evidence: [evidence('description', text, chosen.start, chosen.end)],
    });
    // Capped so the period and FX steps appended by normalizeSalary always fit in the 64-step trace.
    const MAX_SKIPPED_STEPS = 8;
    const skipped = an.statements.filter((s) => s !== chosen);
    for (const s of skipped.slice(0, MAX_SKIPPED_STEPS)) {
      tb.step({
        ruleId: 'salary.select.skipped',
        op: 'select',
        label: `Skipped another ${s.kind === 'ote' ? 'OTE' : 'base'} statement`,
        inputs: { kind: s.kind },
        output: null,
        evidence: [evidence('description', text, s.start, s.end)],
      });
    }
    if (skipped.length > MAX_SKIPPED_STEPS) {
      tb.step({ ruleId: 'salary.select.skipped_more', op: 'select', label: `Skipped ${skipped.length - MAX_SKIPPED_STEPS} more statements`, inputs: { count: skipped.length - MAX_SKIPPED_STEPS }, output: null });
    }
  }
  statementSteps(chosen, text, tb);
  const trace = tb.build('value');
  const minMinor = chosen.minMinor === null ? null : toSafe(chosen.minMinor, 'minimum');
  const maxMinor = chosen.maxMinor === null ? null : toSafe(chosen.maxMinor, 'maximum');
  const parse: SalaryParse = {
    source: 'text',
    kind: chosen.kind,
    ctc: chosen.ctc,
    currency: chosen.currency,
    currencyRule: chosen.currencyRule,
    period: chosen.period,
    periodRule: chosen.periodRule,
    bound: chosen.bound,
    minMinor,
    maxMinor,
    confidence: chosen.confidence,
    evidence: [evidence('description', text, chosen.start, chosen.end)],
    trace,
  };
  return { parse, trace };
}

/** `text` MUST be Doc.text (offsets). Returns null when nothing passes, and the null is never an estimate. */
export function parseSalary(text: string, structured?: StructuredComp | null, ctx?: SalaryContext): SalaryParse | null {
  return parseSalaryTraced(text, structured, ctx).parse;
}

// ---------------------------------------------------------------------------------------------
// normalisation

export interface AnnualPair {
  USD: number | null;
  INR: number | null;
}

export interface NormalizedSalary {
  minorMin: number | null;
  minorMax: number | null;
  currency: Iso4217;
  period: 'year';
  stated: { minorMin: number | null; minorMax: number | null; period: PayPeriod };
  kind: 'base' | 'ote';
  source: SalaryParse['source'];
  annualMin: AnnualPair;
  annualMax: AnnualPair;
  fxAsOf: string;
  fxSource: string;
  trace: Trace;
}

const ADVERB: Record<PayPeriod, string> = { hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' };

function rangeText(lo: number | null, hi: number | null, currency: Iso4217): string {
  if (lo !== null && hi !== null && lo !== hi) return `${formatMoney(lo, currency)}–${formatMoney(hi, currency)}`;
  const v = lo ?? hi;
  return v === null ? '' : formatMoney(v, currency);
}

export function normalizeSalary(parse: SalaryParse, fx: FxSnapshot): NormalizedSalary {
  validateFx(fx);
  const tb = new TraceBuilder('salary');
  tb.append(parse.trace.steps);
  const factor = ANNUAL_FACTOR[parse.period];
  const annual = (v: number | null): number | null => {
    if (v === null) return null;
    const r = BigInt(v) * BigInt(factor);
    return toSafe(r, 'annualised amount');
  };
  const minorMin = annual(parse.minMinor);
  const minorMax = annual(parse.maxMinor);
  const cur = parse.currency;
  const out = { minMinor: minorMin, maxMinor: minorMax };
  if (parse.period === 'year') {
    tb.step({
      ruleId: 'salary.period.identity',
      op: 'identity',
      label: `Yearly ${rangeText(parse.minMinor, parse.maxMinor, cur)}: already per year`,
      inputs: { period: 'year', factor: 1 },
      output: out,
    });
  } else {
    tb.step({
      ruleId: 'salary.period.annualise',
      op: 'convert',
      label: `${ADVERB[parse.period]} ${rangeText(parse.minMinor, parse.maxMinor, cur)} × ${factor} = ${rangeText(minorMin, minorMax, cur)} per year`,
      inputs: { period: parse.period, factor },
      output: out,
    });
  }
  const pair = (target: Iso4217): { min: number | null; max: number | null } => {
    const cmin = minorMin === null ? null : convertMinor(minorMin, cur, target, fx);
    const cmax = minorMax === null ? null : convertMinor(minorMax, cur, target, fx);
    const first = cmin ?? cmax!;
    const ruleId = first.rule;
    const label =
      first.rule === 'salary.fx.identity'
        ? `${target} is the stated currency; no conversion`
        : first.rule === 'salary.fx.missing_rate'
          ? `No ${cur}→${target} rate in the ${fx.asOf} snapshot; ${target} left empty`
          : `${cur} → ${target} at ${first.rate} (${fx.source}, ${fx.asOf})`;
    tb.step({
      ruleId,
      op: first.rule === 'salary.fx.missing_rate' ? 'default' : first.rule === 'salary.fx.identity' ? 'identity' : 'convert',
      label,
      inputs: { from: cur, to: target, rate: first.rate, asOf: fx.asOf, source: fx.source },
      output: { min: cmin?.value ?? null, max: cmax?.value ?? null },
      evidence: [{ source: 'fx', start: 0, end: 0, quote: `${fx.source} ${fx.asOf}`.slice(0, 160), path: `fx_rates.${target}` }],
    });
    return { min: cmin?.value ?? null, max: cmax?.value ?? null };
  };
  const usd = pair('USD');
  const inr = pair('INR');
  return {
    minorMin,
    minorMax,
    currency: cur,
    period: 'year',
    stated: { minorMin: parse.minMinor, minorMax: parse.maxMinor, period: parse.period },
    kind: parse.kind,
    source: parse.source,
    annualMin: { USD: usd.min, INR: inr.min },
    annualMax: { USD: usd.max, INR: inr.max },
    fxAsOf: fx.asOf,
    fxSource: fx.source,
    trace: tb.build('value'),
  };
}

export const SUPPORTED_ISO_CODES = ISO_CODES;
