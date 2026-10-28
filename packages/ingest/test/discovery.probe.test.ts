import { describe, expect, it } from 'vitest';
import { countIndia, formatSummary, probeAll, summarize, type FetchLike } from '../src/discovery/probe';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const GH = { jobs: [{ id: 1, location: { name: 'Bengaluru, India' } }, { id: 2, location: { name: 'London' } }] };
const LEVER = [
  { id: 'a', categories: { location: 'Remote - India' } },
  { id: 'b', categories: { location: 'NYC', allLocations: ['NYC', 'Pune'] } },
  { id: 'c', categories: {} },
];
const ASHBY = { jobs: [{ title: 'x', location: 'Mumbai' }, { title: 'y', location: 'Berlin', secondaryLocations: [{ location: 'Hyderabad' }] }] };

function router(map: Record<string, () => Response | Promise<Response>>, log: string[] = []): FetchLike {
  return async (url) => {
    log.push(url);
    for (const [k, v] of Object.entries(map)) if (url.includes(k)) return v();
    return json({}, 404);
  };
}

const opts = { minIntervalMs: 0, retryDelayMs: 0 };
const cand = (token: string, name = token) => ({ name, token });

describe('countIndia', () => {
  it('matches India or Indian cities, case-insensitively, on word boundaries', () => {
    expect(countIndia(['Bengaluru', 'BANGALORE, KA', 'Remote (India)', 'Gurgaon', 'Paris', '', null, undefined])).toBe(4);
    expect(countIndia(['Indiana, USA', 'Pune Road, Dublin'])).toBe(1);
  });
});

describe('probeAll', () => {
  it('records hits per ATS with job and India counts', async () => {
    const f = router({
      'greenhouse.io/v1/boards/acme/': () => json(GH),
      'lever.co/v0/postings/acme': () => json(LEVER),
      'ashbyhq.com/posting-api/job-board/acme': () => json(ASHBY),
    });
    const r = await probeAll([cand('acme', 'Acme')], { ...opts, fetch: f });
    const byAts = Object.fromEntries(r.hits.map((h) => [h.ats, h]));
    expect(byAts.greenhouse).toMatchObject({ token: 'acme', name: 'Acme', job_count: 2, india_count: 1 });
    expect(byAts.lever).toMatchObject({ job_count: 3, india_count: 2 });
    expect(byAts.ashby).toMatchObject({ job_count: 2, india_count: 2 });
    expect(r.probed).toBe(3);
  });

  it('treats 404 as a miss and does not retry it', async () => {
    const log: string[] = [];
    const r = await probeAll([cand('nope')], { ...opts, fetch: router({}, log) });
    expect(r.hits).toEqual([]);
    expect(log).toHaveLength(3);
    expect(r.misses).toBe(3);
  });

  it('retries once on 5xx then succeeds', async () => {
    let n = 0;
    const f: FetchLike = async (url) => {
      if (!url.includes('greenhouse')) return json({}, 404);
      return ++n === 1 ? json({}, 503) : json(GH);
    };
    const r = await probeAll([cand('acme')], { ...opts, fetch: f });
    expect(n).toBe(2);
    expect(r.hits.map((h) => h.ats)).toEqual(['greenhouse']);
  });

  it('gives up after one retry on persistent 5xx and reports an error, not a hit', async () => {
    let n = 0;
    const f: FetchLike = async (url) => {
      if (url.includes('lever')) {
        n++;
        return json({}, 500);
      }
      return json({}, 404);
    };
    const r = await probeAll([cand('acme')], { ...opts, fetch: f });
    expect(n).toBe(2);
    expect(r.hits).toEqual([]);
    expect(r.errors).toBe(1);
  });

  it('rejects 200 responses with the wrong shape', async () => {
    const f = router({
      'greenhouse': () => json({ nothing: true }),
      'lever': () => json({ jobs: [] }),
      'ashby': () => json([1, 2]),
    });
    const r = await probeAll([cand('acme')], { ...opts, fetch: f });
    expect(r.hits).toEqual([]);
    expect(r.invalid).toBe(3);
  });

  it('rejects a 200 with non-JSON body', async () => {
    const f: FetchLike = async () => new Response('<html>hi</html>', { status: 200 });
    const r = await probeAll([cand('acme')], { ...opts, fetch: f });
    expect(r.hits).toEqual([]);
  });

  it('counts a valid empty board as a hit with zero jobs', async () => {
    const f = router({ 'lever': () => json([]) });
    const r = await probeAll([cand('acme')], { ...opts, fetch: f });
    expect(r.hits).toMatchObject([{ ats: 'lever', job_count: 0, india_count: 0 }]);
  });

  it('survives network errors and timeouts as errors', async () => {
    const f: FetchLike = async () => {
      throw new Error('boom');
    };
    const r = await probeAll([cand('acme')], { ...opts, fetch: f });
    expect(r.errors).toBe(3);
    expect(r.hits).toEqual([]);
  });

  it('passes the honest user agent, JSON accept and a timeout signal', async () => {
    const seen: { headers: Record<string, string>; signal?: AbortSignal }[] = [];
    const f: FetchLike = async (_u, init) => {
      seen.push(init as never);
      return json({}, 404);
    };
    await probeAll([cand('acme')], { ...opts, fetch: f });
    expect(seen[0]!.headers['user-agent']).toMatch(/^HirelaneDiscovery\/0\.1 \(\+https?:\/\/\S+\/contact\)$/);
    expect(seen[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses only the documented public endpoints', async () => {
    const log: string[] = [];
    await probeAll([cand('acme')], { ...opts, fetch: router({}, log) });
    expect(log.sort()).toEqual([
      'https://api.ashbyhq.com/posting-api/job-board/acme',
      'https://api.lever.co/v0/postings/acme?mode=json',
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs',
    ]);
  });

  it('never exceeds concurrency 4', async () => {
    let live = 0;
    let peak = 0;
    const f: FetchLike = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return json({}, 404);
    };
    const cs = Array.from({ length: 20 }, (_, i) => cand(`t${i}`));
    await probeAll(cs, { ...opts, fetch: f, concurrency: 99 });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('limits to 2 requests/second per host', async () => {
    let t = 0;
    const starts: Record<string, number[]> = {};
    const f: FetchLike = async (url) => {
      (starts[new URL(url).host] ??= []).push(t);
      return json({}, 404);
    };
    const cs = Array.from({ length: 5 }, (_, i) => cand(`t${i}`));
    await probeAll(cs, { fetch: f, retryDelayMs: 0, now: () => t, sleep: async (ms) => void (t += ms) });
    for (const s of Object.values(starts)) {
      expect(s).toHaveLength(5);
      for (let i = 1; i < s.length; i++) expect(s[i]! - s[i - 1]!).toBeGreaterThanOrEqual(500);
    }
  });

  it('dedupes repeated tokens', async () => {
    const log: string[] = [];
    await probeAll([cand('acme'), cand('acme', 'Acme Inc')], { ...opts, fetch: router({}, log) });
    expect(log).toHaveLength(3);
  });

  it('handles an empty candidate list', async () => {
    const r = await probeAll([], { ...opts, fetch: router({}) });
    expect(r).toMatchObject({ probed: 0, hits: [] });
  });
});

describe('summarize', () => {
  it('totals tokens, hits per ATS, jobs and India jobs', () => {
    const s = summarize(
      { probed: 6, tokens: 2, misses: 3, errors: 0, invalid: 0, hits: [
        { name: 'a', token: 'a', ats: 'greenhouse', url: 'u', job_count: 5, india_count: 2, probed_at: 'x' },
        { name: 'a', token: 'a', ats: 'lever', url: 'u', job_count: 1, india_count: 0, probed_at: 'x' },
        { name: 'b', token: 'b', ats: 'greenhouse', url: 'u', job_count: 4, india_count: 1, probed_at: 'x' },
      ] },
    );
    expect(s).toMatchObject({ tokens: 2, requests: 6, hitsByAts: { greenhouse: 2, lever: 1, ashby: 0 }, totalJobs: 10, indiaJobs: 3 });
    const text = formatSummary(s);
    expect(text).toContain('greenhouse');
    expect(text).toContain('company_boards');
    expect(text).toContain('verified_at');
  });
});
