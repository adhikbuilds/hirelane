import { gunzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordBoards, type Candidate } from '../src/record/record';
import { trimDescriptions } from '../src/record/trim';

const cand = (ats: Candidate['ats'], token: string): Candidate => ({
  name: token,
  domain: `${token}.com`,
  ats,
  token,
  hires_in_india: false,
});

const jobsFor = (ats: string, n: number, desc = 'd') => {
  if (ats === 'lever') return Array.from({ length: n }, (_, i) => ({ id: `l${i}`, text: 't', description: desc }));
  const key = ats === 'greenhouse' ? 'content' : 'descriptionHtml';
  return { jobs: Array.from({ length: n }, (_, i) => ({ id: i, title: 't', [key]: desc })) };
};

function mockFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; at: number }[] = [];
  const f = async (url: string) => {
    calls.push({ url, at: Date.now() });
    const k = Object.keys(routes).find((r) => url.includes(r));
    if (!k) return new Response('nf', { status: 404 });
    return routes[k]!();
  };
  return { f, calls };
}
const json = (v: unknown, status = 200) => () => new Response(JSON.stringify(v), { status });

const run = async (cands: Candidate[], routes: Record<string, () => Response>, extra = {}) => {
  const outDir = mkdtempSync(join(tmpdir(), 'rec-'));
  const { f, calls } = mockFetch(routes);
  const r = await recordBoards({
    candidates: cands,
    fetch: f,
    outDir,
    now: () => new Date('2026-10-16T00:00:00Z'),
    minIntervalMs: 0,
    sleep: async () => {},
    ...extra,
  });
  return { r, outDir, calls };
};

describe('recordBoards', () => {
  const cands = [
    cand('ashby', 'openai'),
    cand('ashby', 'benchling'),
    cand('ashby', 'temporal'),
    cand('greenhouse', 'gh1'),
    cand('lever', 'lv1'),
    cand('greenhouse', 'gone'),
    cand('lever', 'empty'),
  ];
  const routes = {
    'job-board/openai': json(jobsFor('ashby', 3)),
    'job-board/benchling': json(jobsFor('ashby', 2)),
    'job-board/temporal': json(jobsFor('ashby', 1)),
    'boards/gh1/jobs': json(jobsFor('greenhouse', 4)),
    'postings/lv1': json(jobsFor('lever', 2)),
    'boards/gone/jobs': json({ error: 'nf' }, 404),
    'postings/empty': json([]),
  };

  it('writes gzipped byte-exact bodies, drops 404 and empty boards, and records status', async () => {
    const { r, outDir } = await run(cands, routes);
    expect(r.boards.map((b) => `${b.ats}:${b.token}`).sort()).toEqual([
      'ashby:benchling',
      'ashby:openai',
      'ashby:temporal',
      'greenhouse:gh1',
      'lever:lv1',
    ]);
    expect(r.dropped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: 'gone', reason: 'http_404' }),
        expect.objectContaining({ token: 'empty', reason: 'empty' }),
      ]),
    );
    const gz = readFileSync(join(outDir, 'fixtures/full/ashby/openai.json.gz'));
    expect(JSON.parse(gunzipSync(gz).toString())).toEqual(jobsFor('ashby', 3));
    expect(existsSync(join(outDir, 'fixtures/full/greenhouse/gone.json.gz'))).toBe(false);
    const boards = JSON.parse(readFileSync(join(outDir, 'boards.json'), 'utf8'));
    expect(boards).toHaveLength(5);
    expect(boards[0]).toMatchObject({ verified_at: '2026-10-16T00:00:00.000Z', http_status: 200 });
    expect(boards.find((b: any) => b.token === 'gh1')).toMatchObject({ postings: 4, name: 'gh1', domain: 'gh1.com' });
  });

  it('derives fixtures/mini with 5 boards including the required three', async () => {
    const { r, outDir } = await run(cands, routes);
    expect(r.mini.sort()).toEqual(['ashby:benchling', 'ashby:openai', 'ashby:temporal', 'greenhouse:gh1', 'lever:lv1']);
    for (const k of r.mini) {
      const [ats, token] = k.split(':');
      const a = readFileSync(join(outDir, `fixtures/full/${ats}/${token}.json.gz`));
      const b = readFileSync(join(outDir, `fixtures/mini/${ats}/${token}.json.gz`));
      expect(b.equals(a)).toBe(true);
    }
  });

  it('treats invalid JSON as a dropped board, not a crash', async () => {
    const { r } = await run([cand('ashby', 'bad'), ...cands], { ...routes, 'job-board/bad': () => new Response('<html>', { status: 200 }) });
    expect(r.dropped).toContainEqual(expect.objectContaining({ token: 'bad', reason: 'invalid_json' }));
  });

  it('drops a board whose body exceeds the size cap', async () => {
    const { r } = await run([cand('greenhouse', 'huge'), ...cands], { ...routes, 'boards/huge/jobs': json(jobsFor('greenhouse', 50)) }, { maxBytes: 200 });
    expect(r.dropped).toContainEqual(expect.objectContaining({ token: 'huge', reason: 'too_large' }));
    expect(r.boards.some((b) => b.token === 'huge')).toBe(false);
  });

  it('retries once on 429 honouring Retry-After and then keeps the board', async () => {
    let n = 0;
    const slept: number[] = [];
    const { r } = await run(cands, {
      ...routes,
      'boards/gh1/jobs': () =>
        n++ === 0 ? new Response('', { status: 429, headers: { 'retry-after': '2' } }) : new Response(JSON.stringify(jobsFor('greenhouse', 4)), { status: 200 }),
    }, { sleep: async (ms: number) => void slept.push(ms) });
    expect(r.boards.some((b) => b.token === 'gh1')).toBe(true);
    expect(slept).toContain(2000);
  });

  it('never calls anything but the three read-only list URLs', async () => {
    const { calls } = await run(cands, routes);
    for (const c of calls) {
      expect(c.url).toMatch(
        /^https:\/\/(boards-api\.greenhouse\.io\/v1\/boards\/[\w.-]+\/jobs\?content=true|api\.lever\.co\/v0\/postings\/[\w.-]+\?mode=json|api\.ashbyhq\.com\/posting-api\/job-board\/[\w.-]+\?includeCompensation=true)$/,
      );
    }
  });

  it('rejects tokens that fail the token pattern without fetching', async () => {
    const { r, calls } = await run([cand('ashby', '../evil'), ...cands], routes);
    expect(r.dropped).toContainEqual(expect.objectContaining({ token: '../evil', reason: 'bad_token' }));
    expect(calls.some((c) => c.url.includes('evil'))).toBe(false);
  });

  it('trims descriptions of the largest boards past 200 postings when over the total budget', async () => {
    const big = jobsFor('ashby', 300, 'x'.repeat(2000));
    const { r, outDir } = await run(
      [cand('ashby', 'openai'), cand('ashby', 'benchling'), cand('ashby', 'temporal'), cand('greenhouse', 'gh1'), cand('lever', 'lv1')],
      { ...routes, 'job-board/openai': json(big) },
      { budgetBytes: 1500 },
    );
    expect(r.trimmed.map((t) => t.token)).toContain('openai');
    const body = JSON.parse(gunzipSync(readFileSync(join(outDir, 'fixtures/full/ashby/openai.json.gz'))).toString());
    expect(body.jobs).toHaveLength(300);
    expect(body.jobs[199].descriptionHtml).toHaveLength(2000);
    expect(body.jobs[200].descriptionHtml).toBe('');
    const total = readdirSync(join(outDir, 'fixtures/full'), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.gz'))
      .reduce((s, e) => s + statSync(join(e.parentPath, e.name)).size, 0);
    expect(total).toBeLessThanOrEqual(1500 + 5000);
  });
});

describe('trimDescriptions', () => {
  it('blanks greenhouse content, lever description fields and ashby html beyond keep, leaving other fields', () => {
    const gh = { jobs: [{ id: 1, content: 'a' }, { id: 2, content: 'b', title: 'T' }] };
    expect(trimDescriptions('greenhouse', gh, 1)).toEqual({ jobs: [{ id: 1, content: 'a' }, { id: 2, content: '', title: 'T' }] });
    const lv = [{ id: 'a', description: 'x', lists: [{ text: 't', content: 'c' }] }, { id: 'b', description: 'y', descriptionPlain: 'p', additional: 'z', lists: [{ text: 't', content: 'c' }], text: 'T' }];
    expect(trimDescriptions('lever', lv, 1)[1]).toEqual({ id: 'b', description: '', descriptionPlain: '', additional: '', lists: [], text: 'T' });
    const ab = { jobs: [{ id: 1, descriptionHtml: 'h', descriptionPlain: 'p' }, { id: 2, descriptionHtml: 'h', descriptionPlain: 'p' }] };
    expect(trimDescriptions('ashby', ab, 1).jobs[1]).toEqual({ id: 2, descriptionHtml: '', descriptionPlain: '' });
  });
});
