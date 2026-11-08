import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { makeJsonLdConnector } from '../src/jsonld/connector';
import type { FetchBoardOptions } from '../src/contract';
import { B, HOST, SITE, jf, siteFetch } from './jsonld.helpers';

const NOW = new Date('2026-11-06T00:00:00Z');
const allow = { [HOST]: { maxPages: 50 } };

function setup(overrides: Parameters<typeof siteFetch>[0] = {}, allowHosts: Record<string, { maxPages?: number }> = allow) {
  const s = siteFetch(overrides);
  const sleeps: number[] = [];
  const connector = makeJsonLdConnector({ allowHosts, now: () => NOW, sleep: async (ms) => void sleeps.push(ms) });
  const opts = (): FetchBoardOptions => ({ mode: 'live', fetch: s.fetch, signal: new AbortController().signal });
  return { ...s, sleeps, connector, opts };
}

describe('jsonld connector', () => {
  it('boardUrl is the robots.txt of the host', () => {
    expect(setup().connector.boardUrl(HOST)).toBe(`${B}/robots.txt`);
  });

  it('starts from robots.txt Sitemap lines, honours Disallow, stays on the host, and parses JobPosting JSON-LD', async () => {
    const t = setup();
    const r = await t.connector.fetchBoard(HOST, t.opts());
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.ats).toBe('jsonld');
    expect(r.postings.map((p) => p.externalId).sort()).toEqual(['TC-1001', 'TC-2002', 'TC-3003']);
    expect(r.seenExternalIds.sort()).toEqual(['TC-1001', 'TC-2002', 'TC-3003']);
    expect(r.unlistedCount).toBe(1); // the expired role
    // never requested: disallowed path, non-career path, foreign host, the foreign sitemap
    for (const bad of ['/jobs/internal-referral-only', '/about-us', 'other.example.org', 'elsewhere.example.com']) {
      expect(t.urls.some((u) => u.includes(bad))).toBe(false);
    }
    // the trailing-slash duplicate is fetched once
    expect(t.urls.filter((u) => u.includes('graduate-engineer-bengaluru'))).toHaveLength(1);
    expect(t.urls[0]).toBe(`${B}/robots.txt`);
  });

  it('only ever requests https URLs on the board host and sends html/xml accept headers', async () => {
    const t = setup();
    const heads: Record<string, string>[] = [];
    const inner = t.fetch;
    await t.connector.fetchBoard(HOST, { mode: 'live', signal: new AbortController().signal, fetch: (u, i) => (heads.push(i.headers), inner(u, i)) });
    expect(t.urls.every((u) => u.startsWith(`${B}/`))).toBe(true);
    expect(heads.every((h) => typeof h['accept'] === 'string')).toBe(true);
  });

  it('waits for the robots Crawl-delay between page requests', async () => {
    const t = setup();
    await t.connector.fetchBoard(HOST, t.opts());
    expect(t.sleeps.filter((ms) => ms === 2000).length).toBeGreaterThanOrEqual(3);
  });

  it('refuses a host that is not on the allowlist, with zero requests', async () => {
    const t = setup({}, {});
    const r = await t.connector.fetchBoard(HOST, t.opts());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual({ kind: 'schema', issues: ['host not on the allowlist'] });
    expect(t.urls).toEqual([]);
  });

  it('rejects tokens that are not plain hostnames', async () => {
    const t = setup();
    await expect(t.connector.fetchBoard('a/b', t.opts())).rejects.toThrow(/invalid board token/);
    await expect(t.connector.fetchBoard('127.0.0.1', t.opts())).rejects.toThrow(/invalid board token/);
    await expect(t.connector.fetchBoard('localhost', t.opts())).rejects.toThrow(/invalid board token/);
  });

  it('fails (never returns a partial ok) when robots.txt is missing, blocks everything, or lists no sitemap', async () => {
    const miss = setup({ [`${B}/robots.txt`]: { status: 404, body: '' } });
    const m = await miss.connector.fetchBoard(HOST, miss.opts());
    expect(!m.ok && m.error.kind).toBe('not_found');

    const blocked = setup({ [`${B}/robots.txt`]: { body: 'User-agent: *\nDisallow: /\nSitemap: https://careers.trelliscloud.in/sitemap-jobs.xml' } });
    const b = await blocked.connector.fetchBoard(HOST, blocked.opts());
    expect(!b.ok && b.error.kind === 'schema' && b.error.issues[0]).toMatch(/disallow/i);
    expect(blocked.urls).toEqual([`${B}/robots.txt`]);

    const none = setup({ [`${B}/robots.txt`]: { body: 'User-agent: *\nAllow: /' } });
    const n = await none.connector.fetchBoard(HOST, none.opts());
    expect(!n.ok && n.error.kind === 'schema' && n.error.issues[0]).toMatch(/Sitemap/);
    expect(none.urls).toEqual([`${B}/robots.txt`]);
  });

  it('backs off once on 429 then reports rate_limited; same for 5xx', async () => {
    const url = `${B}/jobs/graduate-engineer-bengaluru`;
    const t = setup({ [url]: { status: 429, body: '', headers: { 'retry-after': '3' } } });
    const r = await t.connector.fetchBoard(HOST, t.opts());
    expect(!r.ok && r.error).toEqual({ kind: 'rate_limited', retryAfterMs: 3000 });
    expect(t.urls.filter((u) => u === url)).toHaveLength(2);
    expect(t.sleeps).toContain(3000);

    const t2 = setup({ [url]: { status: 503, body: '' } });
    const r2 = await t2.connector.fetchBoard(HOST, t2.opts());
    expect(!r2.ok && r2.error).toEqual({ kind: 'http', status: 503 });
  });

  it('a 404/410/403 job page is skipped, not fatal', async () => {
    const t = setup({ [`${B}/jobs/data-analyst-chicago`]: { status: 410, body: '' } });
    const r = await t.connector.fetchBoard(HOST, t.opts());
    expect(r.ok && r.postings.map((p) => p.externalId).sort()).toEqual(['TC-1001', 'TC-2002']);
  });

  it('fails instead of truncating when the sitemap lists more job pages than the host cap', async () => {
    const t = setup({}, { [HOST]: { maxPages: 2 } });
    const r = await t.connector.fetchBoard(HOST, t.opts());
    expect(!r.ok && r.error.kind === 'schema' && r.error.issues[0]).toMatch(/more than 2/);
  });

  it('reads gzipped sitemaps and follows an index', async () => {
    const t = setup({
      [`${B}/sitemap-jobs.xml`]: { body: '' },
      [`${B}/sitemap-index.xml`]: { body: '<sitemapindex><sitemap><loc>https://careers.trelliscloud.in/jobs.xml.gz</loc></sitemap></sitemapindex>' },
    });
    const gz = gzipSync(Buffer.from(jf('sitemap-jobs.xml')));
    const inner = t.fetch;
    const r = await t.connector.fetchBoard(HOST, {
      mode: 'live', signal: new AbortController().signal,
      fetch: async (u, i) => (u === `${B}/jobs.xml.gz` ? new Response(gz, { status: 200 }) : inner(u, i)),
    });
    expect(r.ok && r.postings.length).toBe(3);
  });

  it('exposes only JSON-LD data: raw never holds page html', async () => {
    const t = setup();
    const r = await t.connector.fetchBoard(HOST, t.opts());
    if (!r.ok) throw new Error('fail');
    expect(JSON.stringify(r.postings.map((p) => p.raw))).not.toContain('secret page html');
    expect(Object.keys(SITE).length).toBeGreaterThan(5);
  });
});
