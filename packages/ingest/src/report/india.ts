/** India coverage report: pure aggregation over open India jobs. The CLI (india-cli.ts) feeds it rows from the database. */
import { INDIA_CITIES } from '../jsonld/india';

export interface IndiaJobRow {
  company: string;
  title: string;
  level: string | null;
  /** jobs.locations jsonb: `{ all: string[], perLocation: [{ part, country, remote? }] }`. Shape is not trusted. */
  locations: unknown;
  sourceKind: string | null;
  sourceLabel: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
}

export type Freshness = '<=7d' | '8-30d' | '31-90d' | '>90d';
export interface Counted { key: string; n: number }
export interface IndiaSummary {
  total: number;
  fresherFriendly: number;
  byCity: Counted[];
  bySource: Counted[];
  bySourceLabel: Counted[];
  byFreshness: Record<Freshness, number>;
  newTotal: number;
  topNewEmployers: { company: string; n: number }[];
}

const ALIAS: Record<string, string> = {
  bangalore: 'Bengaluru', gurgaon: 'Gurugram', 'new delhi': 'Delhi', cochin: 'Kochi', trivandrum: 'Thiruvananthapuram',
  mysore: 'Mysuru', baroda: 'Vadodara', vizag: 'Visakhapatnam', calicut: 'Kozhikode', pondicherry: 'Puducherry',
  mangalore: 'Mangaluru', secunderabad: 'Hyderabad', trichy: 'Tiruchirappalli', hubli: 'Hubballi',
};
const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const canon = (c: string) => ALIAS[c] ?? titleCase(c);
const CITIES_LONGEST_FIRST = [...INDIA_CITIES].sort((a, b) => b.length - a.length);
const cityIn = (text: string): string | null => {
  const t = text.toLowerCase();
  for (const c of CITIES_LONGEST_FIRST) if (new RegExp(`\\b${c.replace(/ /g, '\\s+')}\\b`).test(t)) return canon(c);
  return null;
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** First Indian city mentioned by an India-country location part; else Remote (India) for remote-only; else Other India. */
export function cityOf(locations: unknown): string {
  if (!isObj(locations)) return 'Other India';
  const per = Array.isArray(locations['perLocation']) ? locations['perLocation'] : [];
  let remote = false;
  for (const p of per) {
    if (!isObj(p) || p['country'] !== 'IN') continue;
    const part = typeof p['part'] === 'string' ? p['part'] : '';
    const c = cityIn(part);
    if (c) return c;
    if (p['remote'] === true || /\bremote\b/i.test(part)) remote = true;
  }
  if (per.length === 0 && Array.isArray(locations['all'])) {
    for (const a of locations['all']) if (typeof a === 'string') { const c = cityIn(a); if (c) return c; }
  }
  return remote ? 'Remote (India)' : 'Other India';
}

const FRESHER_TITLE = /\b(fresher|freshers|graduate trainee|graduate engineer|new grad|trainee|apprentice|campus hire|entry[- ]level|associate trainee)\b/i;
export function isFresherFriendly(level: string | null, title: string): boolean {
  return level === 'entry' || level === 'intern' || FRESHER_TITLE.test(title);
}

export function freshness(r: Pick<IndiaJobRow, 'postedAt' | 'firstSeenAt'>, now: Date): Freshness {
  const t = (r.postedAt ?? r.firstSeenAt).getTime();
  const days = Math.max(0, (now.getTime() - t) / 86_400_000);
  return days <= 7 ? '<=7d' : days <= 30 ? '8-30d' : days <= 90 ? '31-90d' : '>90d';
}

const rank = (m: Map<string, number>): Counted[] =>
  [...m].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

export function summarizeIndia(rows: readonly IndiaJobRow[], opts: { now: Date; since: Date }): IndiaSummary {
  const city = new Map<string, number>();
  const source = new Map<string, number>();
  const label = new Map<string, number>();
  const employers = new Map<string, number>();
  const byFreshness: Record<Freshness, number> = { '<=7d': 0, '8-30d': 0, '31-90d': 0, '>90d': 0 };
  let fresher = 0;
  let newTotal = 0;
  for (const r of rows) {
    bump(city, cityOf(r.locations));
    bump(source, r.sourceKind ?? 'unknown');
    bump(label, r.sourceLabel ?? 'unknown');
    byFreshness[freshness(r, opts.now)]++;
    if (isFresherFriendly(r.level, r.title)) fresher++;
    if (r.firstSeenAt >= opts.since) {
      newTotal++;
      bump(employers, r.company);
    }
  }
  return {
    total: rows.length,
    fresherFriendly: fresher,
    byCity: rank(city),
    bySource: rank(source),
    bySourceLabel: rank(label).slice(0, 25),
    byFreshness,
    newTotal,
    topNewEmployers: rank(employers).slice(0, 20).map((c) => ({ company: c.key, n: c.n })),
  };
}
