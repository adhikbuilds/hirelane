/** Corpus scoring for the paste-a-job lane. Pure; callers pass the raw JSONL text. Used by tests and engine:eval. */
import type { Criterion } from '../eligibility/types';
import { parsePastedJob } from '../jobtext';
import { detectScamSignals } from '../scam';

export const JOBTEXT_THRESHOLDS = { fieldAccuracy: 0.9, scamRecall: 0.95, scamFalsePositiveRate: 0.05 } as const;

function rows<T>(raw: string): T[] {
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const r = JSON.parse(line) as T & { _header?: unknown };
    if (r._header !== undefined) continue;
    out.push(r);
  }
  return out;
}

interface ScamRow {
  id: string;
  label: 'scam' | 'legit';
  text: string;
  senderEmail?: string;
  url?: string;
  signals: string[];
}

export interface ScamScore {
  total: number;
  scam: number;
  legit: number;
  /** Fraction of scam lines with risk >= medium. */
  recall: number;
  /** Fraction of legit lines with risk >= medium. */
  fpRate: number;
  /** Fraction of expected signal ids found across scam lines (informational). */
  signalRecall: number;
  missed: string[];
  falsePositives: string[];
}

/** A line counts as flagged when `flagged` (risk >= medium). */
export function scoreScamCorpus(raw: string): ScamScore {
  const rs = rows<ScamRow>(raw);
  const scam = rs.filter((r) => r.label === 'scam');
  const legit = rs.filter((r) => r.label === 'legit');
  const run = (r: ScamRow) => detectScamSignals(r.text, { senderEmail: r.senderEmail, url: r.url });
  const missed: string[] = [];
  let expected = 0;
  let found = 0;
  for (const r of scam) {
    const res = run(r);
    if (!res.flagged) missed.push(r.id);
    const got = new Set(res.signals.map((s) => s.id));
    for (const id of r.signals) {
      expected++;
      if (got.has(id as never)) found++;
    }
  }
  const falsePositives = legit.filter((r) => run(r).flagged).map((r) => r.id);
  return {
    total: rs.length,
    scam: scam.length,
    legit: legit.length,
    recall: scam.length === 0 ? 0 : (scam.length - missed.length) / scam.length,
    fpRate: legit.length === 0 ? 0 : falsePositives.length / legit.length,
    signalRecall: expected === 0 ? 1 : found / expected,
    missed,
    falsePositives,
  };
}

interface JobRow {
  id: string;
  style: string;
  text: string;
  sharedUrl: string | null;
  title: string;
  company: string;
  criteria: string[];
  fresher: boolean;
  source: string;
  city: string;
}

const num = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '-' : String(n));
/** Canonical, offset-free criterion key; same format as drive-criteria.labelled.jsonl. */
export function criterionKey(c: Criterion): string {
  switch (c.type) {
    case 'min_score':
      return `min|${[...c.levels].sort().join(',')}|${num(c.pct)}|${num(c.cgpa)}|${c.throughout ? 'T' : 'F'}`;
    case 'no_active_backlogs':
      return 'nobl';
    case 'max_backlog_history':
      return `blh|${c.n}`;
    case 'passout_years':
      return `yr|${[...c.years].sort((a, b) => a - b).join(',')}`;
    case 'degrees':
      return `deg|${[...c.list].sort().join(',')}`;
    case 'branches':
      return `br|${[...c.list].sort().join(',')}`;
    case 'max_gap_years':
      return `gap|${c.n}`;
  }
}

const fold = (s: string | null): string => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const styleGroup = (s: string): string => (s.startsWith('wa_') ? 'whatsapp' : s.split('_')[0]!);

export interface PastedJobScore {
  rows: number;
  byStyle: Record<string, number>;
  title: number;
  company: number;
  /** Row-level exact match of the full criterion set. */
  criteria: number;
  source: number;
  fresher: number;
  location: number;
  misses: { title: string[]; company: string[]; criteria: string[]; source: string[]; fresher: string[] };
}

export function scorePastedJobs(raw: string): PastedJobScore {
  const rs = rows<JobRow>(raw);
  const misses: PastedJobScore['misses'] = { title: [], company: [], criteria: [], source: [], fresher: [] };
  const byStyle: Record<string, number> = {};
  let title = 0;
  let company = 0;
  let criteria = 0;
  let source = 0;
  let fresher = 0;
  let location = 0;
  for (const r of rs) {
    const g = styleGroup(r.style);
    byStyle[g] = (byStyle[g] ?? 0) + 1;
    const p = parsePastedJob(r.text, { sharedUrl: r.sharedUrl });
    if (fold(p.title) === fold(r.title)) title++;
    else misses.title.push(`${r.id}: got ${JSON.stringify(p.title)} want ${JSON.stringify(r.title)}`);
    if (fold(p.company) === fold(r.company)) company++;
    else misses.company.push(`${r.id}: got ${JSON.stringify(p.company)} want ${JSON.stringify(r.company)}`);
    const got = [...new Set(p.criteria.map(criterionKey))].sort();
    const want = [...r.criteria].sort();
    if (got.length === want.length && got.every((k, i) => k === want[i])) criteria++;
    else misses.criteria.push(`${r.id}: got [${got.join(' ; ')}] want [${want.join(' ; ')}]`);
    if (p.sourceHint === r.source) source++;
    else misses.source.push(`${r.id}: got ${p.sourceHint} want ${r.source}`);
    if (p.fresher.fresher === r.fresher) fresher++;
    else misses.fresher.push(`${r.id}: got ${p.fresher.fresher} (${p.fresher.reason}) want ${r.fresher}`);
    if (p.locations.some((l) => fold(l) === fold(r.city))) location++;
  }
  const n = rs.length || 1;
  return { rows: rs.length, byStyle, title: title / n, company: company / n, criteria: criteria / n, source: source / n, fresher: fresher / n, location: location / n, misses };
}
