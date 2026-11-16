/**
 * schema.org JobPosting JSON-LD connector (CLAUDE.md legal guardrails, approved 2026-10-29).
 * token = an allowlisted career-site hostname. Flow: robots.txt -> its Sitemap lines -> career-looking job URLs that
 * robots allows -> JSON-LD block of each page. Never crawls links, never stores HTML, never calls APIs.
 * A failure anywhere returns a failed board, never a partial ok (a partial seen-set would soft-close live jobs).
 * Rate limiting (1 request/s/host) and the user agent come from the injected policy fetch; Crawl-delay is added on top.
 */
import { gunzipSync } from 'node:zlib';
import {
  FetchPolicyError,
  type BoardFetch,
  type Connector,
  type FetchBoardError,
  type FetchBoardOptions,
  type FetchBoardResult,
  type ItemError,
  type RawPosting,
} from '../contract';
import { loadAllowlist, type HostPolicy } from '../allowlist';
import { extractJobPostings } from './extract';
import { parseJobPosting } from './jobposting';
import { parseRobots } from './robots';
import { parseSitemap } from './sitemap';

export const DEFAULT_MAX_PAGES = 300;
const MAX_SITEMAP_FILES = 20;
const MAX_SITEMAP_DEPTH = 2;
const MAX_CRAWL_DELAY_MS = 10_000;
const MAX_PAGE_CHARS = 2_000_000;
const SKIP_STATUS = new Set([403, 404, 410, 451]);
/** A URL is a job-page candidate only when its path looks like one. Keeps blog, about and legal pages out. */
export const JOB_PATH_RE = /(job|career|opening|position|vacanc|requisition|opportunit|posting|role)/i;

const HOST_RE = /^(?=.{1,100}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function assertHost(token: string): string {
  const h = typeof token === 'string' ? token.toLowerCase() : '';
  if (!HOST_RE.test(h) || /^[0-9.]+$/.test(h) || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) {
    throw new Error(`invalid board token: ${JSON.stringify(token)}`);
  }
  return h;
}

export interface JsonLdDeps {
  allowHosts?: Record<string, HostPolicy> | (() => Record<string, HostPolicy>);
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface CrawlStats {
  pagesFetched: number;
  jobPostings: number;
  indiaPostings: number;
  companies: string[];
  sitemapUrls: number;
  candidateUrls: number;
}

type Got = { kind: 'ok'; status: number; headers: Headers; bytes: Buffer } | { kind: 'skip' } | { kind: 'fail'; error: FetchBoardError; status: number | null };

const retryAfter = (h: string | null): number | null => {
  if (!h) return null;
  const s = Number(h);
  return Number.isFinite(s) && s >= 0 ? Math.round(s * 1000) : null;
};

function normUrl(u: string): string {
  const x = new URL(u);
  x.hash = '';
  if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, '');
  return x.toString();
}

export async function crawlJsonLd(
  token: string,
  opts: FetchBoardOptions,
  deps: JsonLdDeps = {},
): Promise<{ result: FetchBoardResult; stats: CrawlStats }> {
  const host = assertHost(token);
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const t0 = performance.now();
  let bytes = 0;
  const stats: CrawlStats = { pagesFetched: 0, jobPostings: 0, indiaPostings: 0, companies: [], sitemapUrls: 0, candidateUrls: 0 };
  const fail = (error: FetchBoardError, httpStatus: number | null = null) => ({
    result: { ok: false, ats: 'jsonld', token: host, error, httpStatus, bytes, durationMs: Math.round(performance.now() - t0) } as FetchBoardResult,
    stats,
  });
  const schema = (msg: string) => fail({ kind: 'schema', issues: [msg] });

  const table = typeof deps.allowHosts === 'function' ? deps.allowHosts() : (deps.allowHosts ?? loadAllowlist().jsonld);
  const policy = table[host];
  if (!policy) return schema('host not on the allowlist');
  const maxPages = policy.maxPages ?? DEFAULT_MAX_PAGES;
  const base = `https://${host}`;

  async function once(url: string, accept: string): Promise<Got> {
    let res: Response;
    try {
      res = await (opts.fetch as BoardFetch)(url, { signal: opts.signal, headers: { accept } });
    } catch (e) {
      if (e instanceof FetchPolicyError) {
        const d = e.detail;
        const error: FetchBoardError =
          e.kind === 'timeout' ? { kind: 'timeout' }
          : e.kind === 'too_large' ? { kind: 'too_large', limitBytes: d.limitBytes ?? 0 }
          : e.kind === 'rate_limited' ? { kind: 'rate_limited', retryAfterMs: d.retryAfterMs ?? null }
          : { kind: 'network', message: d.cause instanceof Error ? d.cause.message : 'network error' };
        return { kind: 'fail', error, status: null };
      }
      if (opts.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return { kind: 'fail', error: { kind: 'aborted' }, status: null };
      return { kind: 'fail', error: { kind: 'network', message: e instanceof Error ? e.message : String(e) }, status: null };
    }
    const status = res.status;
    if (status < 200 || status >= 300) {
      void res.body?.cancel().catch(() => {});
      if (status === 429) return { kind: 'fail', error: { kind: 'rate_limited', retryAfterMs: retryAfter(res.headers.get('retry-after')) }, status };
      return { kind: 'fail', error: status === 404 ? { kind: 'not_found' } : { kind: 'http', status }, status };
    }
    try {
      const bytesBuf = Buffer.from(await res.arrayBuffer());
      bytes += bytesBuf.length;
      return { kind: 'ok', status, headers: res.headers, bytes: bytesBuf };
    } catch (e) {
      if (e instanceof FetchPolicyError && e.kind === 'too_large') return { kind: 'fail', error: { kind: 'too_large', limitBytes: e.detail.limitBytes ?? 0 }, status };
      return { kind: 'fail', error: { kind: 'network', message: e instanceof Error ? e.message : String(e) }, status };
    }
  }

  /** One retry after a back-off on 429 / 5xx (CLAUDE.md rule 3), then the failure stands. */
  async function get(url: string, accept: string, skippable: boolean): Promise<Got> {
    let g = await once(url, accept);
    if (g.kind === 'fail' && (g.status === 429 || (g.status !== null && g.status >= 500))) {
      const wait = g.error.kind === 'rate_limited' && g.error.retryAfterMs !== null ? Math.min(g.error.retryAfterMs, 60_000) : 2000;
      await sleep(wait);
      g = await once(url, accept);
    }
    if (g.kind === 'fail' && skippable && g.status !== null && SKIP_STATUS.has(g.status)) return { kind: 'skip' };
    return g;
  }

  // 1. robots.txt
  const rob = await get(`${base}/robots.txt`, 'text/plain', false);
  if (rob.kind === 'fail') return fail(rob.error, rob.status);
  if (rob.kind !== 'ok') return fail({ kind: 'not_found' });
  const robots = parseRobots(rob.bytes.toString('utf8'));
  if (!robots.isAllowed('/')) return schema('robots.txt disallows the site for our user agent');
  const sitemapUrls = robots.sitemaps.map((s) => { try { return new URL(s); } catch { return null; } }).filter((u): u is URL => u !== null && u.protocol === 'https:' && u.hostname === host);
  if (sitemapUrls.length === 0) return schema('robots.txt lists no Sitemap on this host');

  const delay = robots.crawlDelayMs !== null && robots.crawlDelayMs > 1000 ? Math.min(robots.crawlDelayMs, MAX_CRAWL_DELAY_MS) : 0;
  const pause = async () => { if (delay) await sleep(delay); };

  // 2. sitemaps (index recursion bounded)
  const jobUrls = new Map<string, string>();
  let files = 0;
  const queue: { url: string; depth: number }[] = sitemapUrls.map((u) => ({ url: u.toString(), depth: 0 }));
  const seenMaps = new Set<string>();
  while (queue.length) {
    const { url, depth } = queue.shift()!;
    if (seenMaps.has(url)) continue;
    seenMaps.add(url);
    if (++files > MAX_SITEMAP_FILES) break;
    await pause();
    const g = await get(url, 'application/xml,text/xml,*/*;q=0.5', true);
    if (g.kind === 'fail') return fail(g.error, g.status);
    if (g.kind === 'skip') continue;
    const buf = g.bytes.length > 2 && g.bytes[0] === 0x1f && g.bytes[1] === 0x8b ? gunzipSync(g.bytes) : g.bytes;
    const sm = parseSitemap(buf.toString('utf8'));
    for (const e of sm.entries) {
      let u: URL;
      try { u = new URL(e.loc); } catch { continue; }
      if (u.protocol !== 'https:' || u.hostname !== host) continue;
      if (sm.kind === 'index') {
        if (depth < MAX_SITEMAP_DEPTH) queue.push({ url: u.toString(), depth: depth + 1 });
        continue;
      }
      stats.sitemapUrls++;
      if (!JOB_PATH_RE.test(u.pathname)) continue;
      if (!robots.isAllowed(u.pathname + u.search)) continue;
      const k = normUrl(u.toString());
      if (!jobUrls.has(k)) jobUrls.set(k, u.toString());
    }
  }
  stats.candidateUrls = jobUrls.size;
  if (jobUrls.size > maxPages) return schema(`sitemap lists more than ${maxPages} job pages (${jobUrls.size}); raise max_pages on the allowlist entry`);

  // 3. job pages: JSON-LD only
  const postings: RawPosting[] = [];
  const seen = new Set<string>();
  const taken = new Set<string>();
  const itemErrors: ItemError[] = [];
  const companies = new Set<string>();
  let unlisted = 0;
  let index = 0;
  for (const pageUrl of jobUrls.values()) {
    const i = index++;
    await pause();
    const g = await get(pageUrl, 'text/html,application/xhtml+xml', true);
    if (g.kind === 'fail') return fail(g.error, g.status);
    if (g.kind === 'skip') continue;
    stats.pagesFetched++;
    const html = g.bytes.toString('utf8').slice(0, MAX_PAGE_CHARS);
    for (const jp of extractJobPostings(html)) {
      const r = parseJobPosting(jp, { pageUrl, host, now: now() });
      if (r.kind === 'expired') { unlisted++; continue; }
      if (r.kind !== 'ok') { itemErrors.push({ index: i, externalId: null, reason: r.kind === 'bad_url' ? 'bad_url' : 'missing_title' }); continue; }
      const id = r.posting.externalId;
      seen.add(id);
      if (taken.has(id)) { itemErrors.push({ index: i, externalId: id, reason: 'duplicate_id' }); continue; }
      taken.add(id);
      postings.push(r.posting);
      stats.jobPostings++;
      if (r.india.isIndia) stats.indiaPostings++;
      if (r.company) companies.add(r.company);
    }
  }
  stats.companies = [...companies];

  return {
    result: {
      ok: true, ats: 'jsonld', token: host, source: opts.mode, postings, seenExternalIds: [...seen], itemErrors,
      unlistedCount: unlisted, httpStatus: 200, bytes, durationMs: Math.round(performance.now() - t0),
    },
    stats,
  };
}

export function makeJsonLdConnector(deps: JsonLdDeps = {}): Connector {
  return {
    ats: 'jsonld',
    boardUrl: (token) => `https://${assertHost(token)}/robots.txt`,
    async fetchBoard(token, opts) {
      return (await crawlJsonLd(token, opts, deps)).result;
    },
  };
}

export const jsonld = makeJsonLdConnector();
