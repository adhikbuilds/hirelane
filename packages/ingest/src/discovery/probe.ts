/** Probes public ATS board endpoints for candidate tokens. Public JSON only; no auth, no scraping. */
import { createHostLimiter } from '../record/limiter';

export type DiscoveryAts = 'greenhouse' | 'lever' | 'ashby';
export const ATS_LIST: DiscoveryAts[] = ['greenhouse', 'lever', 'ashby'];

/** Same pattern as the recorder: contact URL is the web app's /contact page (localhost until a public origin exists). */
export const DISCOVERY_USER_AGENT = 'HirelaneDiscovery/0.1 (+http://localhost:3001/contact)';

export const ENDPOINTS: Record<DiscoveryAts, (t: string) => string> = {
  greenhouse: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
  lever: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
  ashby: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
};

export type FetchLike = (url: string, init?: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export interface Candidate {
  name: string;
  token: string;
}

export interface Hit {
  name: string;
  token: string;
  ats: DiscoveryAts;
  url: string;
  job_count: number;
  india_count: number;
  probed_at: string;
}

export interface ProbeResult {
  /** Requests that got a final outcome (a retried request counts once). */
  probed: number;
  /** Distinct tokens probed. */
  tokens: number;
  hits: Hit[];
  misses: number;
  errors: number;
  invalid: number;
}

export interface ProbeOptions {
  fetch: FetchLike;
  concurrency?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  userAgent?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onResult?: (r: { name: string; token: string; ats: DiscoveryAts; outcome: 'hit' | 'miss' | 'error' | 'invalid' }) => void;
}

const INDIA_CITIES = [
  'india', 'bengaluru', 'bangalore', 'mumbai', 'navi mumbai', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida',
  'greater noida', 'hyderabad', 'pune', 'chennai', 'kolkata', 'ahmedabad', 'jaipur', 'kochi', 'cochin', 'chandigarh',
  'indore', 'coimbatore', 'thiruvananthapuram', 'trivandrum', 'bhubaneswar', 'lucknow', 'nagpur', 'vadodara', 'mysuru',
  'mysore', 'mohali', 'surat', 'visakhapatnam',
];
const INDIA_RE = new RegExp(`\\b(?:${INDIA_CITIES.join('|')})\\b`, 'i');

export function countIndia(locations: ReadonlyArray<string | null | undefined>): number {
  return locations.filter((l) => typeof l === 'string' && INDIA_RE.test(l)).length;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);

/** Returns job and India counts, or null when the JSON is not a board of this ATS. */
function parseBoard(ats: DiscoveryAts, body: unknown): { jobs: number; india: number } | null {
  if (ats === 'lever') {
    if (!Array.isArray(body)) return null;
    const india = body.filter((p) => {
      if (!isObj(p)) return false;
      const c = isObj(p.categories) ? p.categories : {};
      const all = Array.isArray(c.allLocations) ? c.allLocations.map(str) : [];
      return countIndia([str(c.location), ...all]) > 0;
    }).length;
    return { jobs: body.length, india };
  }
  if (!isObj(body) || !Array.isArray(body.jobs)) return null;
  const jobs = body.jobs;
  let india = 0;
  for (const j of jobs) {
    if (!isObj(j)) continue;
    const locs: Array<string | null> = [];
    if (ats === 'greenhouse') {
      locs.push(isObj(j.location) ? str(j.location.name) : null);
      if (Array.isArray(j.offices)) for (const o of j.offices) if (isObj(o)) locs.push(str(o.name), str(o.location));
    } else {
      locs.push(str(j.location));
      if (Array.isArray(j.secondaryLocations)) for (const s of j.secondaryLocations) locs.push(isObj(s) ? str(s.location) : str(s));
      const addr = isObj(j.address) && isObj(j.address.postalAddress) ? j.address.postalAddress : null;
      if (addr) locs.push(str(addr.addressCountry), str(addr.addressLocality));
    }
    if (countIndia(locs) > 0) india++;
  }
  return { jobs: jobs.length, india };
}

export async function probeAll(candidates: Candidate[], opts: ProbeOptions): Promise<ProbeResult> {
  const concurrency = Math.max(1, Math.min(4, opts.concurrency ?? 4));
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retryDelayMs = opts.retryDelayMs ?? 1000;
  const ua = opts.userAgent ?? DISCOVERY_USER_AGENT;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limiter = createHostLimiter({
    minIntervalMs: opts.minIntervalMs ?? 500, // 2 requests/s per host
    sleep,
    ...(opts.now ? { now: opts.now } : {}),
  });

  const seen = new Set<string>();
  const unique = candidates.filter((c) => (seen.has(c.token) ? false : (seen.add(c.token), true)));
  // token-major so consecutive tasks hit different hosts
  const tasks = unique.flatMap((c) => ATS_LIST.map((ats) => ({ c, ats })));

  const res: ProbeResult = { probed: 0, tokens: unique.length, hits: [], misses: 0, errors: 0, invalid: 0 };

  const request = (url: string) =>
    limiter.run(new URL(url).host, () =>
      opts.fetch(url, { headers: { 'user-agent': ua, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }),
    );

  async function one(c: Candidate, ats: DiscoveryAts): Promise<'hit' | 'miss' | 'error' | 'invalid'> {
    const url = ENDPOINTS[ats](c.token);
    try {
      let r = await request(url);
      if (r.status >= 500) {
        await r.body?.cancel().catch(() => undefined);
        await sleep(retryDelayMs);
        r = await request(url);
      }
      if (r.status === 404) {
        await r.body?.cancel().catch(() => undefined);
        return 'miss';
      }
      if (r.status !== 200) {
        await r.body?.cancel().catch(() => undefined);
        return 'error';
      }
      let body: unknown;
      try {
        body = await r.json();
      } catch {
        return 'invalid';
      }
      const b = parseBoard(ats, body);
      if (!b) return 'invalid';
      res.hits.push({
        name: c.name, token: c.token, ats, url, job_count: b.jobs, india_count: b.india, probed_at: new Date().toISOString(),
      });
      return 'hit';
    } catch {
      return 'error';
    }
  }

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const t = tasks[next++];
      if (!t) return;
      const outcome = await one(t.c, t.ats);
      res.probed++;
      if (outcome === 'miss') res.misses++;
      else if (outcome === 'error') res.errors++;
      else if (outcome === 'invalid') res.invalid++;
      opts.onResult?.({ name: t.c.name, token: t.c.token, ats: t.ats, outcome });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return res;
}

export interface Summary {
  tokens: number;
  requests: number;
  hitsByAts: Record<DiscoveryAts, number>;
  totalJobs: number;
  indiaJobs: number;
  misses: number;
  errors: number;
  invalid: number;
}

export function summarize(r: ProbeResult): Summary {
  const hitsByAts: Record<DiscoveryAts, number> = { greenhouse: 0, lever: 0, ashby: 0 };
  let totalJobs = 0;
  let indiaJobs = 0;
  for (const h of r.hits) {
    hitsByAts[h.ats]++;
    totalJobs += h.job_count;
    indiaJobs += h.india_count;
  }
  return { tokens: r.tokens, requests: r.probed, hitsByAts, totalJobs, indiaJobs, misses: r.misses, errors: r.errors, invalid: r.invalid };
}

export function formatSummary(s: Summary): string {
  const rows: Array<[string, string | number]> = [
    ['tokens probed', s.tokens],
    ['requests', s.requests],
    ['hits: greenhouse', s.hitsByAts.greenhouse],
    ['hits: lever', s.hitsByAts.lever],
    ['hits: ashby', s.hitsByAts.ashby],
    ['total jobs', s.totalJobs],
    ['India jobs', s.indiaJobs],
    ['misses (404)', s.misses],
    ['errors', s.errors],
    ['invalid shape', s.invalid],
  ];
  const w = Math.max(...rows.map(([k]) => k.length));
  const table = rows.map(([k, v]) => `${k.padEnd(w)}  ${v}`).join('\n');
  return `${table}\n\nv1 does not write to the DB. Later, each hit maps to a company_boards row (ats, token, company from name) inserted unverified, with verified_at set once the normal connector ingest of that board succeeds with HTTP 200.`;
}
