import { describe, expect, it } from 'vitest';
import { makeZohoConnector, parseZohoToken, zohoFeedUrl } from '../src/zoho/rss';
import { jf, siteFetch } from './jsonld.helpers';

const TOKEN = 'in-60012345678';
const URL_ = 'https://recruit.zoho.in/recruit/downloadrssfeed?orgId=60012345678';
const opts = (fetch: ReturnType<typeof siteFetch>['fetch']) => ({ mode: 'live' as const, fetch, signal: new AbortController().signal });
const conn = (allow: Record<string, object> = { [TOKEN]: {} }) => makeZohoConnector({ allowTokens: allow });

describe('zoho token', () => {
  it('parses region and org id, rejects anything else', () => {
    expect(parseZohoToken(TOKEN)).toEqual({ region: 'in', orgId: '60012345678' });
    expect(zohoFeedUrl(TOKEN)).toBe(URL_);
    for (const bad of ['in-abc', 'xx-60012345678', 'in-1', '../x', 'recruit.zoho.in']) expect(() => zohoFeedUrl(bad)).toThrow(/invalid board token/);
  });
});

describe('zoho rss connector', () => {
  it('boardUrl is the documented feed path', () => expect(conn().boardUrl(TOKEN)).toBe(URL_));

  it('maps RSS items, skipping bad links/titles and de-duplicating', async () => {
    const s = siteFetch({ [URL_]: { body: jf('zoho-feed.xml') } });
    const r = await conn().fetchBoard(TOKEN, opts(s.fetch));
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.ats).toBe('zoho_rss');
    expect(s.urls).toEqual([URL_]);
    expect(r.postings.map((p) => p.externalId)).toEqual(['ZR_101_JOB', 'd:def456']);
    const p = r.postings[0]!;
    expect(p.title).toBe('Graduate Trainee - Operations');
    expect(p.url).toBe('https://trellis.zohorecruit.in/recruit/ViewJob.na?digest=abc123&embedsource=RSS');
    expect(p.applyUrl).toBe(p.url);
    expect(p.locationsRaw).toEqual(['Pune, Maharashtra, India']);
    expect(p.postedAt).toBe('2026-11-02T03:30:00.000Z');
    expect(p.descriptionHtml).toBe('<p>Freshers welcome. Pune.</p>');
    expect(p.employmentRaw).toBe('Full time');
    expect(p.compensation).toBeNull();
    expect(r.postings[1]!.title).toBe('Sales Executive & Support');
    expect(r.postings[1]!.locationsRaw).toEqual([]);
    expect(r.itemErrors.map((e) => e.reason).sort()).toEqual(['bad_url', 'duplicate_id', 'missing_title']);
  });

  it('refuses a feed that is not allowlisted, without any request', async () => {
    const s = siteFetch();
    const r = await conn({}).fetchBoard(TOKEN, opts(s.fetch));
    expect(!r.ok && r.error).toEqual({ kind: 'schema', issues: ['feed not on the allowlist'] });
    expect(s.urls).toEqual([]);
  });

  it('404 is not_found, 429 is rate_limited with retry-after, 5xx is http, non-RSS is a schema failure', async () => {
    const t = async (status: number, body = '', headers: Record<string, string> = {}) => {
      const s = siteFetch({ [URL_]: { status, body, headers } });
      return conn().fetchBoard(TOKEN, opts(s.fetch));
    };
    expect((await t(404)) as never).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    expect((await t(429, '', { 'retry-after': '7' })) as never).toMatchObject({ error: { kind: 'rate_limited', retryAfterMs: 7000 } });
    expect((await t(503)) as never).toMatchObject({ error: { kind: 'http', status: 503 } });
    expect((await t(200, '<html>login</html>')) as never).toMatchObject({ error: { kind: 'schema' } });
  });

  it('an empty channel is a valid empty board', async () => {
    const s = siteFetch({ [URL_]: { body: '<rss><channel><title>x</title></channel></rss>' } });
    const r = await conn().fetchBoard(TOKEN, opts(s.fetch));
    expect(r.ok && r.postings).toEqual([]);
  });
});
