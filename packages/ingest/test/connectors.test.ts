import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FetchPolicyError, type FetchBoardOk, type FetchBoardResult } from '../src/contract';
import { greenhouse } from '../src/connectors/greenhouse';
import { lever } from '../src/connectors/lever';
import { ashby } from '../src/connectors/ashby';
import { connectors } from '../src/connectors';
import { fixtureJson, fixtureText, opts, stubFetch, throwingFetch } from './connectors.helpers';

function ok(r: FetchBoardResult): FetchBoardOk {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r;
}

describe('URL templates', () => {
  it('builds the fixed Greenhouse, Lever and Ashby URLs', () => {
    expect(greenhouse.boardUrl('airtable')).toBe('https://boards-api.greenhouse.io/v1/boards/airtable/jobs?content=true');
    expect(lever.boardUrl('cred')).toBe('https://api.lever.co/v0/postings/cred?mode=json');
    expect(ashby.boardUrl('openai')).toBe('https://api.ashbyhq.com/posting-api/job-board/openai?includeCompensation=true');
  });

  it('rejects tokens that could alter the host or path (SSRF)', () => {
    for (const bad of ['', 'a/b', '../x', 'a?b=1', 'a@evil.com', 'a b', 'x'.repeat(101), 'a#b', 'a\\b']) {
      for (const c of Object.values(connectors)) expect(() => c.boardUrl(bad)).toThrow();
    }
    expect(() => greenhouse.boardUrl('addepar1')).not.toThrow();
    expect(() => ashby.boardUrl('a.b_c-d')).not.toThrow();
  });

  it('registers each connector under its ATS name', () => {
    expect(Object.keys(connectors).sort()).toEqual(['ashby', 'greenhouse', 'jsonld', 'lever', 'zoho_rss']);
    for (const [k, c] of Object.entries(connectors)) expect(c.ats).toBe(k);
  });
});

describe('greenhouse against fixtures/mini/greenhouse/airtable', () => {
  const body = fixtureText('mini', 'greenhouse', 'airtable');
  const parsed = fixtureJson('mini', 'greenhouse', 'airtable');
  const run = async (mode: 'fixture' | 'live' = 'fixture') => {
    const s = stubFetch(body);
    const r = ok(await greenhouse.fetchBoard('airtable', opts(s.fetch, mode)));
    return { r, calls: s.calls };
  };

  it('makes exactly one request to the board URL and extracts every item', async () => {
    const { r, calls } = await run();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(greenhouse.boardUrl('airtable'));
    expect(r.postings).toHaveLength(parsed.jobs.length);
    expect(r.seenExternalIds).toEqual(parsed.jobs.map((j: any) => String(j.id)));
    expect(r.itemErrors).toEqual([]);
    expect(r.unlistedCount).toBe(0);
    expect(r.httpStatus).toBe(200);
    expect(r.bytes).toBe(Buffer.byteLength(body));
  });

  it('stringifies the numeric id and tags ats, board and source', async () => {
    const { r } = await run('live');
    const p = r.postings[0]!;
    expect(p.externalId).toBe('8403107002');
    expect(p.ats).toBe('greenhouse');
    expect(p.boardToken).toBe('airtable');
    expect(r.source).toBe('live');
  });

  it('decodes the entity-encoded content exactly once', async () => {
    const { r } = await run();
    const html = r.postings[0]!.descriptionHtml!;
    expect(html.startsWith('<p>Airtable helps organizations')).toBe(true);
    expect(html).not.toContain('&lt;');
    expect(html).toContain('&nbsp;'); // was &amp;nbsp; in the wire format: one decode leaves a real HTML entity
    expect(html).not.toContain('&amp;nbsp;');
    expect(html).toContain("What you'll do"); // &#39;
    expect(html).not.toContain('&#39;');
  });

  it('keeps the untouched item (still entity-encoded) in raw', async () => {
    const { r } = await run();
    expect(r.postings[0]!.raw).toEqual(parsed.jobs[0]);
    expect((r.postings[0]!.raw as any).content.startsWith('&lt;p&gt;')).toBe(true);
  });

  it('maps primary location then office locations without duplicates', async () => {
    const { r } = await run();
    expect(r.postings[0]!.locationsRaw).toEqual(['Remote - US', 'Austin, Texas, United States']);
    expect(r.postings[1]!.locationsRaw).toEqual(['Remote - US']); // office name equals primary
    expect(r.postings[3]!.locationsRaw).toEqual(['London, United Kingdom', 'London, England, United Kingdom']); // trimmed
  });

  it('maps title, department, url, applyUrl and posted time', async () => {
    const { r } = await run();
    const p = r.postings[0]!;
    expect(p.title).toBe('Account Executive, Corporate');
    expect(p.department).toBe('Sales');
    expect(p.team).toBeNull();
    expect(p.url).toBe('https://job-boards.greenhouse.io/airtable/jobs/8403107002');
    expect(p.applyUrl).toBe(p.url);
    expect(p.postedAt).toBe('2026-03-03T16:25:37.000Z'); // -05:00 offset converted to UTC
  });

  it('emits no compensation, workplace or employment when the list endpoint carries none', async () => {
    const { r } = await run();
    for (const p of r.postings) {
      expect(p.compensation).toBeNull();
      expect(p.employmentRaw).toBeNull();
      expect(p.workplaceRaw).toBeNull();
      expect(p.isRemoteHint).toBeNull();
    }
  });

  it('reads employment and workplace only from metadata fields with a matching name', async () => {
    const mut = structuredClone(parsed);
    mut.jobs[0].metadata = [
      { id: 1, name: 'Job Board Function', value: 'Sales', value_type: 'single_select' },
      { id: 2, name: 'Employment Type', value: 'Full-time', value_type: 'single_select' },
      { id: 3, name: 'Workplace', value: 'Hybrid', value_type: 'single_select' },
    ];
    const r = ok(await greenhouse.fetchBoard('airtable', opts(stubFetch(JSON.stringify(mut)).fetch)));
    expect(r.postings[0]!.employmentRaw).toBe('Full-time');
    expect(r.postings[0]!.workplaceRaw).toBe('Hybrid');
    expect(r.postings[1]!.employmentRaw).toBeNull();
  });

  it('handles a missing location and missing departments', async () => {
    const mut = structuredClone(parsed);
    mut.jobs[0].location = null;
    mut.jobs[0].offices = [];
    mut.jobs[0].departments = [];
    mut.jobs[1].location = { name: '   ' };
    const r = ok(await greenhouse.fetchBoard('airtable', opts(stubFetch(JSON.stringify(mut)).fetch)));
    expect(r.postings[0]!.locationsRaw).toEqual([]);
    expect(r.postings[0]!.department).toBeNull();
    expect(r.postings[1]!.locationsRaw).toEqual(['Remote - US']);
  });

  it('trims and collapses whitespace in titles', async () => {
    const mut = structuredClone(parsed);
    mut.jobs[0].title = '  Data   Engineering\n Manager  ';
    const r = ok(await greenhouse.fetchBoard('airtable', opts(stubFetch(JSON.stringify(mut)).fetch)));
    expect(r.postings[0]!.title).toBe('Data Engineering Manager');
  });

  it('records a non-https url as bad_url but keeps the id in the seen set', async () => {
    const mut = structuredClone(parsed);
    mut.jobs[2].absolute_url = 'http://www.example.com/careers?gh_jid=8425211002';
    const r = ok(await greenhouse.fetchBoard('airtable', opts(stubFetch(JSON.stringify(mut)).fetch)));
    expect(r.postings).toHaveLength(4);
    expect(r.itemErrors).toEqual([expect.objectContaining({ index: 2, externalId: '8425211002', reason: 'bad_url' })]);
    expect(r.seenExternalIds).toContain('8425211002');
  });
});

describe('lever against fixtures/mini/lever/cred', () => {
  const body = fixtureText('mini', 'lever', 'cred');
  const parsed = fixtureJson<any[]>('mini', 'lever', 'cred');
  const run = async (b = body) => ok(await lever.fetchBoard('cred', opts(stubFetch(b).fetch)));

  it('extracts every posting from the bare array', async () => {
    const r = await run();
    expect(r.postings).toHaveLength(parsed.length);
    expect(r.seenExternalIds).toEqual(parsed.map((p) => p.id));
    expect(r.itemErrors).toEqual([]);
  });

  it('converts the millisecond createdAt to ISO UTC', async () => {
    const r = await run();
    expect(r.postings[0]!.postedAt).toBe('2026-09-28T05:39:42.021Z');
    expect(r.postings[0]!.postedAt).toBe(new Date(parsed[0].createdAt).toISOString());
  });

  it('maps categories, workplace and urls', async () => {
    const p = (await run()).postings[1]!;
    expect(p.title).toBe('business development & partnerships');
    expect(p.employmentRaw).toBe('full time');
    expect(p.department).toBe('product & growth');
    expect(p.team).toBe('consumer products');
    expect(p.workplaceRaw).toBe('onsite');
    expect(p.isRemoteHint).toBe(false);
    expect(p.url).toBe('https://jobs.lever.co/cred/09022710-e79a-4cf0-8060-df0e1cd64263');
    expect(p.applyUrl).toBe('https://jobs.lever.co/cred/09022710-e79a-4cf0-8060-df0e1cd64263/apply');
    expect(p.locationsRaw).toEqual(['bengaluru']); // allLocations repeats the primary
  });

  it('builds the description from description, lists (as h3 plus content) and additional, undecoded', async () => {
    const p = (await run()).postings[3]!; // has description, two lists and additional
    const src = parsed[3];
    const html = p.descriptionHtml!;
    expect(html.startsWith(src.description)).toBe(true);
    expect(html).toContain(`<h3>${src.lists[0].text}</h3>${src.lists[0].content}`);
    expect(html.endsWith(src.additional)).toBe(true);
    expect(html.indexOf(src.lists[0].text)).toBeLessThan(html.indexOf(src.lists[1].text));
  });

  it('omits an empty list heading and gives null when nothing is present', async () => {
    const first = (await run()).postings[0]!; // empty description, one list with empty text
    expect(first.descriptionHtml).not.toContain('<h3></h3>');
    expect(first.descriptionHtml!.startsWith('<div>')).toBe(true);
    const mut = structuredClone(parsed);
    Object.assign(mut[0], { description: '', additional: '', lists: [] });
    expect((await run(JSON.stringify(mut))).postings[0]!.descriptionHtml).toBeNull();
  });

  it('does not decode entities in Lever HTML (flag is false)', async () => {
    const mut = structuredClone(parsed);
    mut[1].description = '<p>R&amp;D &lt;3</p>';
    mut[1].lists = [];
    mut[1].additional = '';
    expect((await run(JSON.stringify(mut))).postings[1]!.descriptionHtml).toBe('<p>R&amp;D &lt;3</p>');
  });

  it('merges secondary locations after the primary, dropping exact duplicates', async () => {
    const mut = structuredClone(parsed);
    mut[0].categories.location = 'Asia';
    mut[0].categories.allLocations = ['Hong Kong', 'Asia', 'Taiwan, Taipei', 'Hong Kong'];
    expect((await run(JSON.stringify(mut))).postings[0]!.locationsRaw).toEqual(['Asia', 'Hong Kong', 'Taiwan, Taipei']);
  });

  it('handles missing categories.location and allLocations', async () => {
    const mut = structuredClone(parsed);
    delete mut[0].categories.location;
    delete mut[0].categories.allLocations;
    mut[1].categories = {};
    const r = await run(JSON.stringify(mut));
    expect(r.postings[0]!.locationsRaw).toEqual([]);
    expect(r.postings[1]!.locationsRaw).toEqual([]);
    expect(r.postings[1]!.department).toBeNull();
    expect(r.itemErrors).toEqual([]);
  });

  it('sets isRemoteHint from workplaceType remote and null when unspecified', async () => {
    const mut = structuredClone(parsed);
    mut[0].workplaceType = 'remote';
    mut[1].workplaceType = 'unspecified';
    const r = await run(JSON.stringify(mut));
    expect(r.postings[0]!.isRemoteHint).toBe(true);
    expect(r.postings[0]!.workplaceRaw).toBe('remote');
    expect(r.postings[1]!.isRemoteHint).toBeNull();
  });

  it('returns null compensation when the recorded board has no salaryRange', async () => {
    for (const p of (await run()).postings) expect(p.compensation).toBeNull();
  });

  it('maps salaryRange to compensation and treats 0..0 as absent', async () => {
    const mut = structuredClone(parsed);
    mut[0].salaryRange = { currency: 'USD', interval: 'per-year-salary', min: 115000, max: 175000 };
    mut[1].salaryRange = { currency: 'INR', interval: 'per-year-salary', min: 0, max: 0 };
    mut[2].salaryRange = { currency: 'USD', interval: 'per-hour-wage', min: 40, max: 55 };
    mut[3].salaryRange = { currency: 'USD', interval: 'per-fortnight-odd', min: 1, max: 2 };
    const r = await run(JSON.stringify(mut));
    expect(r.postings[0]!.compensation).toEqual({
      min: 115000, max: 175000, currency: 'USD', interval: 'year', kind: 'salary', summaryText: null, source: 'lever.salaryRange',
    });
    expect(r.postings[1]!.compensation).toBeNull();
    expect(r.postings[2]!.compensation).toMatchObject({ interval: 'hour', min: 40, max: 55 });
    expect(r.postings[3]!.compensation).toMatchObject({ interval: 'unknown' });
  });

  it('maps every salaryRange on the recorded full Lever boards', async () => {
    const dir = fileURLToPath(new URL('../fixtures/full/lever/', import.meta.url));
    let withRange = 0;
    for (const f of readdirSync(dir)) {
      const token = f.replace('.json.gz', '');
      const items = fixtureJson<any[]>('full', 'lever', token);
      const r = ok(await lever.fetchBoard(token, opts(stubFetch(JSON.stringify(items)).fetch)));
      items.forEach((it) => {
        const s = it.salaryRange;
        if (!s || (!s.min && !s.max)) return;
        withRange++;
        const c = r.postings.find((p) => p.externalId === it.id)!.compensation;
        expect(c).toMatchObject({ min: s.min ?? null, max: s.max ?? null, currency: s.currency, source: 'lever.salaryRange', kind: 'salary' });
        expect(c!.interval).not.toBe('unknown');
      });
    }
    expect(withRange).toBeGreaterThan(100);
  });
});

describe('ashby against fixtures/mini/ashby/*', () => {
  const runBoard = async (token: string, transform?: (j: any) => void) => {
    const j = fixtureJson('mini', 'ashby', token);
    transform?.(j);
    const s = stubFetch(JSON.stringify(j));
    return { r: ok(await ashby.fetchBoard(token, opts(s.fetch))), j, calls: s.calls };
  };

  it('extracts every listed job and reports the seen set', async () => {
    const { r, j, calls } = await runBoard('benchling');
    expect(calls[0]!.url).toBe(ashby.boardUrl('benchling'));
    expect(r.postings).toHaveLength(j.jobs.length);
    expect(r.seenExternalIds).toEqual(j.jobs.map((x: any) => x.id));
    expect(r.unlistedCount).toBe(0);
  });

  it('maps core fields, workplace, remote hint and ms-precision publishedAt', async () => {
    const { r } = await runBoard('benchling');
    const p = r.postings[0]!;
    expect(p.externalId).toBe('63d7d126-efaf-4a48-b328-f8d85b640ebf');
    expect(p.title).toBe('Software Engineer, Platform (Developer Experience)');
    expect(p.url).toBe('https://jobs.ashbyhq.com/benchling/63d7d126-efaf-4a48-b328-f8d85b640ebf');
    expect(p.applyUrl).toBe(`${p.url}/application`);
    expect(p.department).toBe('Engineering');
    expect(p.team).toBe('Engineering: PAI');
    expect(p.employmentRaw).toBe('FullTime');
    expect(p.workplaceRaw).toBe('Hybrid');
    expect(p.isRemoteHint).toBe(true);
    expect(p.postedAt).toBe('2026-08-25T18:43:47.823Z');
  });

  it('keeps Ashby descriptionHtml as is (already HTML, not entity-encoded)', async () => {
    const { r, j } = await runBoard('benchling');
    expect(r.postings[0]!.descriptionHtml).toBe(j.jobs[0].descriptionHtml);
    expect(r.postings[0]!.descriptionHtml).toContain('R&amp;D');
  });

  it('puts secondary locations after the primary and drops a repeat of the primary', async () => {
    const { r } = await runBoard('temporal');
    const p = r.postings[0]!; // secondary repeats the primary
    expect(p.locationsRaw).toEqual(['San Francisco, California']);
    const multi = r.postings.find((x) => x.locationsRaw.length > 1)!;
    expect(multi.locationsRaw[0]).toBe((multi.raw as any).location);
    expect(multi.locationsRaw.slice(1)).toContain((multi.raw as any).secondaryLocations.find((s: any) => s.location !== (multi.raw as any).location).location);
  });

  it('handles a missing primary location', async () => {
    const { r } = await runBoard('benchling', (j) => {
      j.jobs[0].location = null;
      j.jobs[0].secondaryLocations = [{ location: 'Boston, MA' }];
    });
    expect(r.postings[0]!.locationsRaw).toEqual(['Boston, MA']);
  });

  it('extracts salary in major units, dropping equity', async () => {
    const { r } = await runBoard('openai');
    const p = r.postings[0]!;
    expect(p.compensation).toEqual({
      min: 257000, max: 335000, currency: 'USD', interval: 'year', kind: 'salary',
      summaryText: '$257K - $335K', source: 'ashby.compensation',
    });
    const withComp = r.postings.filter((x) => x.compensation);
    expect(withComp.length).toBeGreaterThan(300);
    for (const x of withComp) expect(x.compensation!.min !== null || x.compensation!.max !== null).toBe(true);
  });

  it('uses the first salary tier on a multi-tier posting', async () => {
    const { r } = await runBoard('temporal');
    const tiered = r.postings.find((x) => ((x.raw as any).compensation?.compensationTiers?.length ?? 0) > 1)!;
    expect(tiered.compensation).toMatchObject({ min: 216000, max: 283500, kind: 'salary' });
  });

  it('respects shouldDisplayCompensationOnJobPostings=false', async () => {
    const { r } = await runBoard('openai');
    const hidden = r.postings.filter((x) => (x.raw as any).shouldDisplayCompensationOnJobPostings === false);
    expect(hidden.length).toBeGreaterThan(0);
    for (const x of hidden) expect(x.compensation).toBeNull();
  });

  it('maps hourly intervals and flags commission-only pay as ote', async () => {
    const { r } = await runBoard('benchling', (j) => {
      j.jobs[0].compensation = { compensationTiers: [{ components: [
        { compensationType: 'Salary', interval: '1 HOUR', currencyCode: 'USD', minValue: 40, maxValue: 60 },
      ] }] };
      j.jobs[1].compensation = { compensationTiers: [{ components: [
        { compensationType: 'EquityPercentage', interval: 'NONE', currencyCode: null, minValue: null, maxValue: null },
        { compensationType: 'Commission', interval: '1 YEAR', currencyCode: 'USD', minValue: 200000, maxValue: 250000 },
      ] }] };
      j.jobs[2].compensation = { compensationTiers: [{ components: [
        { compensationType: 'EquityPercentage', interval: 'NONE', currencyCode: null, minValue: null, maxValue: null },
      ] }] };
      j.jobs[3].compensation = { compensationTiers: [] };
    });
    expect(r.postings[0]!.compensation).toMatchObject({ interval: 'hour', min: 40, max: 60, kind: 'salary' });
    expect(r.postings[1]!.compensation).toMatchObject({ kind: 'ote', min: 200000, max: 250000, interval: 'year' });
    expect(r.postings[2]!.compensation).toBeNull();
    expect(r.postings[3]!.compensation).toBeNull();
  });

  it('excludes unlisted jobs from postings and the seen set and counts them', async () => {
    const { r, j } = await runBoard('benchling', (x) => {
      x.jobs[0].isListed = false;
    });
    expect(r.postings).toHaveLength(j.jobs.length - 1);
    expect(r.seenExternalIds).not.toContain(j.jobs[0].id);
    expect(r.unlistedCount).toBe(1);
  });

  it('falls back to the UUID in jobUrl when id is missing', async () => {
    const { r } = await runBoard('benchling', (j) => {
      delete j.jobs[0].id;
    });
    expect(r.postings[0]!.externalId).toBe('63d7d126-efaf-4a48-b328-f8d85b640ebf');
  });

  it('reports a missing id as missing_id and leaves it out of the seen set', async () => {
    const { r, j } = await runBoard('benchling', (x) => {
      delete x.jobs[0].id;
      x.jobs[0].jobUrl = 'https://jobs.ashbyhq.com/benchling/not-a-uuid';
    });
    expect(r.itemErrors).toEqual([expect.objectContaining({ index: 0, externalId: null, reason: 'missing_id' })]);
    expect(r.seenExternalIds).toHaveLength(j.jobs.length - 1);
  });

  it('keeps the first of duplicate ids, reports the rest, lists the id once', async () => {
    const { r, j } = await runBoard('benchling', (x) => {
      x.jobs[1].id = x.jobs[0].id;
    });
    expect(r.postings).toHaveLength(j.jobs.length - 1);
    expect(r.postings[0]!.title).toBe(j.jobs[0].title);
    expect(r.itemErrors).toEqual([expect.objectContaining({ index: 1, reason: 'duplicate_id', externalId: j.jobs[0].id })]);
    expect(r.seenExternalIds.filter((i) => i === j.jobs[0].id)).toHaveLength(1);
  });

  it('keeps a missing-title item in the seen set', async () => {
    const { r } = await runBoard('benchling', (x) => {
      x.jobs[0].title = '   ';
    });
    expect(r.itemErrors[0]).toMatchObject({ reason: 'missing_title', externalId: '63d7d126-efaf-4a48-b328-f8d85b640ebf' });
    expect(r.seenExternalIds).toContain('63d7d126-efaf-4a48-b328-f8d85b640ebf');
    expect(r.postings.map((p) => p.externalId)).not.toContain('63d7d126-efaf-4a48-b328-f8d85b640ebf');
  });

  it('reports an item whose fields have the wrong type as item_schema without failing the board', async () => {
    const { r, j } = await runBoard('benchling', (x) => {
      x.jobs[0].secondaryLocations = 'oops';
    });
    expect(r.itemErrors[0]).toMatchObject({ index: 0, reason: 'item_schema' });
    expect(r.seenExternalIds).toHaveLength(j.jobs.length);
  });

  it('handles a large board (count derived from the recorded fixture) and stays JSON-serialisable', async () => {
    const { r, j } = await runBoard('openai');
    expect(j.jobs.length).toBeGreaterThan(500);
    expect(r.postings).toHaveLength(j.jobs.length);
    expect(() => JSON.stringify(r.postings.slice(0, 5))).not.toThrow();
  });
});

describe('board-level error mapping (all connectors)', () => {
  const cases = [
    ['greenhouse', greenhouse, 'airtable'],
    ['lever', lever, 'cred'],
    ['ashby', ashby, 'openai'],
  ] as const;

  for (const [name, c, token] of cases) {
    describe(name, () => {
      it('maps 404 to not_found, 500 to http and 429 to rate_limited with Retry-After', async () => {
        const nf = await c.fetchBoard(token, opts(stubFetch('{"ok":false}', 404).fetch));
        expect(nf).toMatchObject({ ok: false, ats: name, token, error: { kind: 'not_found' }, httpStatus: 404 });
        const h = await c.fetchBoard(token, opts(stubFetch('boom', 500).fetch));
        expect(h).toMatchObject({ ok: false, error: { kind: 'http', status: 500 }, httpStatus: 500 });
        const rl = await c.fetchBoard(token, opts(stubFetch('', 429, { 'retry-after': '7' }).fetch));
        expect(rl).toMatchObject({ ok: false, error: { kind: 'rate_limited', retryAfterMs: 7000 }, httpStatus: 429 });
        const rl2 = await c.fetchBoard(token, opts(stubFetch('', 429).fetch));
        expect(rl2).toMatchObject({ ok: false, error: { kind: 'rate_limited', retryAfterMs: null } });
      });

      it('maps policy errors, aborts and network failures without throwing', async () => {
        const e = async (err: unknown, signal?: AbortSignal) => (await c.fetchBoard(token, opts(throwingFetch(err), 'live', signal))) as any;
        expect((await e(new FetchPolicyError('timeout', {}))).error).toEqual({ kind: 'timeout' });
        expect((await e(new FetchPolicyError('too_large', { limitBytes: 20 }))).error).toEqual({ kind: 'too_large', limitBytes: 20 });
        expect((await e(new FetchPolicyError('rate_limited', { retryAfterMs: 1500 }))).error).toEqual({ kind: 'rate_limited', retryAfterMs: 1500 });
        expect((await e(new FetchPolicyError('network', {}))).error.kind).toBe('network');
        expect((await e(new TypeError('fetch failed'))).error).toEqual({ kind: 'network', message: 'fetch failed' });
        const ac = new AbortController();
        ac.abort();
        expect((await e(new DOMException('aborted', 'AbortError'), ac.signal)).error).toEqual({ kind: 'aborted' });
      });

      it('maps unparseable bodies to invalid_json and wrong shapes to schema', async () => {
        expect((await c.fetchBoard(token, opts(stubFetch('<html>').fetch)))).toMatchObject({ ok: false, error: { kind: 'invalid_json' }, httpStatus: 200 });
        const wrong = name === 'lever' ? '{"jobs":[]}' : '[]';
        const r = await c.fetchBoard(token, opts(stubFetch(wrong).fetch));
        expect(r).toMatchObject({ ok: false, error: { kind: 'schema' } });
        const r2 = await c.fetchBoard(token, opts(stubFetch('null').fetch));
        expect(r2).toMatchObject({ ok: false, error: { kind: 'schema' } });
      });

      it('returns ok with zero postings for an empty list (the empty-board guard lives in persistence)', async () => {
        const r = ok(await c.fetchBoard(token, opts(stubFetch(name === 'lever' ? '[]' : '{"jobs":[]}').fetch)));
        expect(r.postings).toEqual([]);
        expect(r.seenExternalIds).toEqual([]);
      });

      it('survives a non-object item', async () => {
        const body = name === 'lever' ? '[null, 5]' : '{"jobs":[null, 5]}';
        const r = ok(await c.fetchBoard(token, opts(stubFetch(body).fetch)));
        expect(r.itemErrors).toHaveLength(2);
        expect(r.seenExternalIds).toEqual([]);
      });
    });
  }
});
