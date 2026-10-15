import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEntities, toDoc } from '../src/text';
import { CURRENCY_EXPONENT, parseSalary, type SalaryParse } from '../src/salary';
import { extractRequirements } from '../src/requirements';

const here = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(here, '..', 'test', 'corpus');

/** Phase 2 acceptance thresholds (PLAN.md Phase 2). */
export const THRESHOLDS = {
  salaryPrecision: 0.98,
  salaryRecall: 0.95,
  salaryPeriodCurrency: 0.98,
  requirementsF1: 0.85,
} as const;

export interface SalaryExpected {
  minMinor: number | null;
  maxMinor: number | null;
  currency: string;
  period: string;
  kind: string;
  ctc: boolean;
  bound: string;
}
export interface SalaryRow {
  id: string;
  origin: 'fixture' | 'hand';
  src: string;
  text: string;
  countries?: string[];
  expected: SalaryExpected | null;
}
export interface ReqRow {
  id: string;
  src: string;
  title: string;
  html: string;
  expected: { kind: 'must' | 'nice'; text: string }[];
}
export interface CorpusHeader {
  corpus: string;
  labelledBy: string;
  labelledAt: string;
  method: string;
  [k: string]: unknown;
}

function loadJsonl<T>(name: string): { header: CorpusHeader; rows: T[] } {
  const lines = readFileSync(join(CORPUS, name), 'utf8').split('\n').filter((l) => l.trim().length > 0);
  const first = JSON.parse(lines[0]!) as { _header?: CorpusHeader };
  if (!first._header) throw new Error(`${name}: first line must be a _header object`);
  return { header: first._header, rows: lines.slice(1).map((l) => JSON.parse(l) as T) };
}
export const loadSalaryCorpus = () => loadJsonl<SalaryRow>('salary.labelled.jsonl');
export const loadRequirementsCorpus = () => loadJsonl<ReqRow>('requirements.labelled.jsonl');

export interface SalaryScore {
  rows: number;
  expectedPositives: number;
  predicted: number;
  correct: number;
  precision: number;
  recall: number;
  periodCurrencyAccuracy: number;
  misses: { id: string; kind: 'false_positive' | 'false_negative' | 'wrong_value'; text: string; expected: SalaryExpected | null; got: unknown }[];
}

function matches(e: SalaryExpected, p: SalaryParse): boolean {
  return e.minMinor === p.minMinor && e.maxMinor === p.maxMinor && e.currency === p.currency && e.period === p.period && e.kind === p.kind;
}

export function scoreSalary(rows: readonly SalaryRow[], parse: typeof parseSalary = parseSalary): SalaryScore {
  let predicted = 0;
  let correct = 0;
  let positives = 0;
  let both = 0;
  let pcOk = 0;
  const misses: SalaryScore['misses'] = [];
  for (const r of rows) {
    const ctx = r.countries ? { countries: r.countries } : undefined;
    const p = parse(r.text, null, ctx);
    const brief = p && { min: p.minMinor, max: p.maxMinor, cur: p.currency, per: p.period, kind: p.kind };
    if (r.expected) positives++;
    if (p) predicted++;
    if (r.expected && p) {
      both++;
      if (r.expected.currency === p.currency && r.expected.period === p.period) pcOk++;
      if (matches(r.expected, p)) correct++;
      else misses.push({ id: r.id, kind: 'wrong_value', text: r.text.slice(0, 160), expected: r.expected, got: brief });
    } else if (p && !r.expected) misses.push({ id: r.id, kind: 'false_positive', text: r.text.slice(0, 160), expected: null, got: brief });
    else if (r.expected && !p) misses.push({ id: r.id, kind: 'false_negative', text: r.text.slice(0, 160), expected: r.expected, got: null });
  }
  return {
    rows: rows.length,
    expectedPositives: positives,
    predicted,
    correct,
    precision: predicted === 0 ? 1 : correct / predicted,
    recall: positives === 0 ? 1 : correct / positives,
    periodCurrencyAccuracy: both === 0 ? 1 : pcOk / both,
    misses,
  };
}

/** Key that ignores spacing, punctuation, case and entity differences between a labelled bullet and a Doc slice. */
export function reqKey(kind: string, text: string): string {
  return kind + '|' + decodeEntities(text).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export interface ReqScore {
  postings: number;
  precision: number;
  recall: number;
  f1: number;
  mustF1: number;
  niceF1: number;
  expected: number;
  predicted: number;
  misses: { id: string; kind: 'missing' | 'extra'; item: string }[];
}

function prf(tp: number, pred: number, exp: number): { p: number; r: number; f1: number } {
  const p = pred === 0 ? 1 : tp / pred;
  const r = exp === 0 ? 1 : tp / exp;
  return { p, r, f1: p + r === 0 ? 0 : (2 * p * r) / (p + r) };
}

/** Micro P/R/F1 over (kind, item) pairs, pooled across postings. */
export function scoreRequirements(rows: readonly ReqRow[], extract: typeof extractRequirements = extractRequirements): ReqScore {
  const t = { all: [0, 0, 0], must: [0, 0, 0], nice: [0, 0, 0] } as Record<string, number[]>;
  const misses: ReqScore['misses'] = [];
  for (const row of rows) {
    const got = extract(toDoc(row.html)).requirements;
    const gotKeys = new Map<string, string>();
    for (const g of got) gotKeys.set(reqKey(g.kind, g.text), `${g.kind}: ${g.text.slice(0, 90)}`);
    const expKeys = new Map<string, string>();
    for (const e of row.expected) expKeys.set(reqKey(e.kind, e.text), `${e.kind}: ${e.text.slice(0, 90)}`);
    for (const [k, label] of expKeys) {
      const kind = k.startsWith('must') ? 'must' : 'nice';
      t.all![2]!++;
      t[kind]![2]!++;
      if (gotKeys.has(k)) {
        t.all![0]!++;
        t[kind]![0]!++;
      } else misses.push({ id: row.id, kind: 'missing', item: label });
    }
    for (const [k, label] of gotKeys) {
      const kind = k.startsWith('must') ? 'must' : 'nice';
      t.all![1]!++;
      t[kind]![1]!++;
      if (!expKeys.has(k)) misses.push({ id: row.id, kind: 'extra', item: label });
    }
  }
  const all = prf(t.all![0]!, t.all![1]!, t.all![2]!);
  return {
    postings: rows.length,
    precision: all.p,
    recall: all.r,
    f1: all.f1,
    mustF1: prf(t.must![0]!, t.must![1]!, t.must![2]!).f1,
    niceF1: prf(t.nice![0]!, t.nice![1]!, t.nice![2]!).f1,
    expected: t.all![2]!,
    predicted: t.all![1]!,
    misses,
  };
}

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_EXPONENT);
