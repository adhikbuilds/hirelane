/**
 * Cross-source de-duplication of normalised jobs. Pure. The kept job is the one from the most authoritative source;
 * the others are recorded in `alsoSeenAt` so the card can still link to every place the role appeared.
 * (Inside the database, enrichment already clusters a company's same-title postings; this covers in-memory sets such as
 * a connector run, the discovery samples and the coverage report.)
 */
import type { SourceKind } from './source';

export interface DedupeJob {
  sourceKind: SourceKind;
  sourceLabel: string;
  sourceUrl: string;
  company: string;
  title: string;
  locations: string[];
  applyUrl: string | null;
  hasSalary: boolean;
  alsoSeenAt?: { sourceKind: SourceKind; sourceLabel: string; sourceUrl: string }[];
}

const PRIORITY: Record<SourceKind, number> = { greenhouse: 0, lever: 1, ashby: 2, jsonld: 3, zoho_rss: 4, campus_drive: 5, user_shared: 6 };

const CO_SUFFIX = /\b(pvt|private|ltd|limited|llp|llc|inc|incorporated|corp|corporation|co)\b/g;
const CITY_ALIAS: Record<string, string> = {
  bangalore: 'bengaluru', gurgaon: 'gurugram', bombay: 'mumbai', madras: 'chennai', calcutta: 'kolkata', cochin: 'kochi',
  trivandrum: 'thiruvananthapuram', mysore: 'mysuru', baroda: 'vadodara', vizag: 'visakhapatnam', pondicherry: 'puducherry',
};

const squash = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function dedupeKey(company: string, title: string): string {
  const co = squash(company).replace(/[.,]/g, '').replace(CO_SUFFIX, ' ').replace(/[^a-z0-9]+/g, '');
  const ti = squash(title)
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b20\d\d\b|\bbatch\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${co}|${ti}`;
}

function cities(locs: string[]): Set<string> {
  const out = new Set<string>();
  for (const l of locs) {
    const c = squash(l).split(',')[0]!.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (c) out.add(CITY_ALIAS[c] ?? c);
  }
  return out;
}

const overlap = (a: Set<string>, b: Set<string>): boolean => (a.size === 0 && b.size === 0) || [...a].some((x) => b.has(x));

function applyKey(u: string | null): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|ref$|source$|gh_src$|lever-source)/i.test(k)) x.searchParams.delete(k);
    x.hash = '';
    return `${x.hostname}${x.pathname.replace(/\/+$/, '')}${x.search}`.toLowerCase();
  } catch {
    return null;
  }
}

interface Cluster {
  head: DedupeJob;
  idx: number;
  cities: Set<string>;
  rest: DedupeJob[];
}

export function dedupeJobs<T extends DedupeJob>(items: T[]): { kept: T[]; dropped: { item: T; keptBy: T }[] } {
  const order = items.map((item, idx) => ({ item, idx })).sort(
    (a, b) => PRIORITY[a.item.sourceKind] - PRIORITY[b.item.sourceKind] || Number(b.item.hasSalary) - Number(a.item.hasSalary) || a.idx - b.idx,
  );
  const byKey = new Map<string, Cluster[]>();
  const byApply = new Map<string, Cluster>();
  const all: Cluster[] = [];
  const dropped: { item: T; keptBy: T }[] = [];

  for (const { item, idx } of order) {
    const ak = applyKey(item.applyUrl);
    const key = dedupeKey(item.company, item.title);
    const c = cities(item.locations);
    let hit = ak ? byApply.get(ak) : undefined;
    if (!hit) hit = (byKey.get(key) ?? []).find((cl) => overlap(cl.cities, c));
    if (hit) {
      hit.rest.push(item);
      for (const x of c) hit.cities.add(x);
      dropped.push({ item, keptBy: hit.head as T });
      continue;
    }
    const cl: Cluster = { head: item, idx, cities: c, rest: [] };
    all.push(cl);
    byKey.set(key, [...(byKey.get(key) ?? []), cl]);
    if (ak) byApply.set(ak, cl);
  }

  const kept = all
    .sort((a, b) => a.idx - b.idx)
    .map((cl) => {
      if (cl.rest.length === 0) return cl.head as T;
      const seen = new Set<string>([cl.head.sourceUrl]);
      const also = cl.rest
        .filter((r) => !seen.has(r.sourceUrl) && !!seen.add(r.sourceUrl))
        .map((r) => ({ sourceKind: r.sourceKind, sourceLabel: r.sourceLabel, sourceUrl: r.sourceUrl }));
      return { ...cl.head, alsoSeenAt: also } as T;
    });
  return { kept, dropped };
}
