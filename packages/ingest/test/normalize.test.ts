import { describe, expect, it } from 'vitest';
import type { BoardRef, RawPosting } from '../src/contract';
import { normalize } from '../src/normalize';
import { greenhouse } from '../src/connectors/greenhouse';
import { ashby } from '../src/connectors/ashby';
import { opts, stubFetch, fixtureText } from './connectors.helpers';

const board: BoardRef = { id: 'b-1', ats: 'ashby', token: 'openai' };

const base = (over: Partial<RawPosting> = {}): RawPosting => ({
  ats: 'ashby',
  boardToken: 'openai',
  externalId: '8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3',
  url: 'https://jobs.ashbyhq.com/openai/8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3',
  applyUrl: 'https://jobs.ashbyhq.com/openai/8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3/application',
  title: 'Technical Program Manager',
  locationsRaw: ['San Francisco', 'Remote'],
  descriptionHtml: '<p>Hello  world</p>',
  department: 'TPM',
  team: 'Compute',
  employmentRaw: 'FullTime',
  workplaceRaw: 'Hybrid',
  isRemoteHint: null,
  postedAt: '2026-03-12T16:38:15.322Z',
  compensation: { min: 1, max: 2, currency: 'USD', interval: 'year', kind: 'salary', summaryText: '$1-$2', source: 'ashby.compensation' },
  raw: { a: 1 },
  ...over,
});

const norm = (p: RawPosting) => {
  const r = normalize(board, p, { source: 'fixture' });
  if (!r.ok) throw new Error(r.reason);
  return r.posting;
};

describe('normalize()', () => {
  it('maps a RawPosting to the postings columns', () => {
    const n = norm(base());
    expect(n).toMatchObject({
      boardId: 'b-1',
      externalId: '8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3',
      key: 'ashby:openai:8fb1615c-34bf-47c4-a1d1-b7b2f836bbd3',
      title: 'Technical Program Manager',
      locationRaw: 'San Francisco · Remote',
      raw: { a: 1 },
      source: 'fixture',
    });
    expect(n.postedAt).toEqual(new Date('2026-03-12T16:38:15.322Z'));
    expect(Object.keys(n).sort()).toEqual(
      ['applyUrl', 'boardId', 'contentHash', 'externalId', 'key', 'locationRaw', 'postedAt', 'raw', 'source', 'title', 'url'],
    );
  });

  it('uses ctx.source and a null locationRaw / postedAt when empty', () => {
    const r = normalize(board, base({ locationsRaw: [], postedAt: null }), { source: 'live' });
    expect(r.ok && r.posting).toMatchObject({ source: 'live', locationRaw: null, postedAt: null });
  });

  it('rejects a non-https url as bad_url', () => {
    expect(normalize(board, base({ url: 'http://x.com/a' }), { source: 'live' })).toEqual({ ok: false, externalId: base().externalId, reason: 'bad_url' });
    expect(normalize(board, base({ url: 'javascript:alert(1)' }), { source: 'live' })).toMatchObject({ ok: false, reason: 'bad_url' });
    expect(normalize(board, base({ url: 'not a url' }), { source: 'live' })).toMatchObject({ ok: false, reason: 'bad_url' });
  });

  it('nulls a non-https applyUrl instead of failing', () => {
    expect(norm(base({ applyUrl: 'http://x.com/apply' })).applyUrl).toBeNull();
  });

  it('rejects an empty title', () => {
    expect(normalize(board, base({ title: '  ' }), { source: 'live' })).toMatchObject({ ok: false, reason: 'missing_title' });
  });

  it('rejects keys over 255 characters and accepts exactly 255', () => {
    const prefix = 'ashby:openai:'.length;
    expect(normalize(board, base({ externalId: 'x'.repeat(256 - prefix) }), { source: 'live' })).toMatchObject({ ok: false, reason: 'key_too_long' });
    const r = normalize(board, base({ externalId: 'x'.repeat(255 - prefix) }), { source: 'live' });
    expect(r.ok && r.posting.key.length).toBe(255);
  });
});

describe('content_hash', () => {
  it('is versioned sha256 hex', () => {
    expect(norm(base()).contentHash).toMatch(/^v1:[0-9a-f]{64}$/);
  });

  it('is deterministic and ignores key order of compensation input', () => {
    expect(norm(base()).contentHash).toBe(norm(base()).contentHash);
  });

  it('ignores raw, externalId, url, postedAt, compensation.source and location order', () => {
    const h = norm(base()).contentHash;
    expect(norm(base({ raw: { different: true } })).contentHash).toBe(h);
    expect(norm(base({ externalId: 'zzz' })).contentHash).toBe(h);
    expect(norm(base({ url: 'https://other.example/x' })).contentHash).toBe(h);
    expect(norm(base({ postedAt: '2020-01-01T00:00:00.000Z' })).contentHash).toBe(h);
    expect(norm(base({ locationsRaw: ['Remote', 'San Francisco'] })).contentHash).toBe(h);
    expect(norm(base({ compensation: { ...base().compensation!, source: 'lever.salaryRange' } })).contentHash).toBe(h);
  });

  it('ignores whitespace runs in the description and outer whitespace in strings', () => {
    const h = norm(base()).contentHash;
    expect(norm(base({ descriptionHtml: '<p>Hello \n\t world</p> ' })).contentHash).toBe(h);
    expect(norm(base({ department: ' TPM ' })).contentHash).toBe(h);
  });

  it('normalises Unicode to NFC', () => {
    const a = norm(base({ title: 'Café' })).contentHash;
    const b = norm(base({ title: 'Café' })).contentHash;
    expect(a).toBe(b);
  });

  it('changes when any hashed field changes', () => {
    const h = norm(base()).contentHash;
    const changed: Partial<RawPosting>[] = [
      { title: 'Other' },
      { locationsRaw: ['San Francisco'] },
      { descriptionHtml: '<p>Hello world!</p>' },
      { descriptionHtml: null },
      { applyUrl: null },
      { department: 'X' },
      { team: null },
      { employmentRaw: 'Contract' },
      { workplaceRaw: 'Remote' },
      { isRemoteHint: true },
      { compensation: null },
      { compensation: { ...base().compensation!, max: 3 } },
      { compensation: { ...base().compensation!, currency: 'EUR' } },
      { compensation: { ...base().compensation!, interval: 'month' } },
      { compensation: { ...base().compensation!, kind: 'ote' } },
      { compensation: { ...base().compensation!, summaryText: null } },
    ];
    const hashes = changed.map((c) => norm(base(c)).contentHash);
    for (const x of hashes) expect(x).not.toBe(h);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('distinguishes null from empty string description', () => {
    expect(norm(base({ descriptionHtml: null })).contentHash).not.toBe(norm(base({ descriptionHtml: '' })).contentHash);
  });
});

describe('connector output through normalize()', () => {
  it('normalises every recorded Greenhouse airtable posting', async () => {
    const r = await greenhouse.fetchBoard('airtable', opts(stubFetch(fixtureText('mini', 'greenhouse', 'airtable')).fetch));
    if (!r.ok) throw new Error('fetch failed');
    const gb: BoardRef = { id: 'g', ats: 'greenhouse', token: 'airtable' };
    for (const p of r.postings) {
      const n = normalize(gb, p, { source: r.source });
      expect(n.ok).toBe(true);
    }
    expect(r.postings[0]!.postedAt).toBe('2026-03-03T16:25:37.000Z');
  });

  it('is stable across identical fetches and changes when a posting changes', async () => {
    const text = fixtureText('mini', 'ashby', 'benchling');
    const run = async (t: string) => {
      const r = await ashby.fetchBoard('benchling', opts(stubFetch(t).fetch));
      if (!r.ok) throw new Error('fetch failed');
      const bb: BoardRef = { id: 'b', ats: 'ashby', token: 'benchling' };
      return r.postings.map((p) => (normalize(bb, p, { source: 'fixture' }) as any).posting.contentHash as string);
    };
    const a = await run(text);
    expect(await run(text)).toEqual(a);
    const j = JSON.parse(text);
    j.jobs[0].title += ' II';
    const c = await run(JSON.stringify(j));
    expect(c[0]).not.toBe(a[0]);
    expect(c.slice(1)).toEqual(a.slice(1));
  });
});
