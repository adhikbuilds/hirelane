import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Ats } from '../contract';
import { fetchCapped, MAX_BYTES, TIMEOUT_MS, type CappedResult } from './fetch';
import { createHostLimiter } from './limiter';
import { deriveMini, type KeptBoard } from './mini';
import { KEEP_FULL_DESCRIPTIONS, trimDescriptions } from './trim';

export interface Candidate {
  name: string;
  domain: string;
  ats: Ats;
  token: string;
  hires_in_india: boolean;
  status?: string;
}

export interface RecordedBoard extends Candidate {
  verified_at: string;
  http_status: number;
  postings: number;
}

export interface Dropped {
  ats: Ats;
  token: string;
  reason: string;
}

export interface RecordResult {
  boards: RecordedBoard[];
  dropped: Dropped[];
  mini: string[];
  trimmed: { ats: Ats; token: string; gzBefore: number; gzAfter: number }[];
  totalGzBytes: number;
  totalPostings: number;
}

export interface RecordOptions {
  candidates: Candidate[];
  fetch: (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
  /** Package root: writes {outDir}/boards.json and {outDir}/fixtures/{full,mini}. */
  outDir: string;
  now?: () => Date;
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxBytes?: number;
  timeoutMs?: number;
  /** Total gzipped size budget for fixtures/full. */
  budgetBytes?: number;
}

export const TOKEN_RE = /^[A-Za-z0-9._-]{1,100}$/;
export const TOTAL_BUDGET_BYTES = 25 * 1024 * 1024;

export function listUrl(ats: Ats, token: string): string {
  const t = encodeURIComponent(token);
  switch (ats) {
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`;
    case 'lever':
      return `https://api.lever.co/v0/postings/${t}?mode=json`;
    case 'ashby':
      return `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`;
  }
}

/** Number of listed postings in a parsed body, or null when the top-level shape is wrong. */
export function countPostings(ats: Ats, body: unknown): number | null {
  if (ats === 'lever') return Array.isArray(body) ? body.length : null;
  const jobs = (body as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) return null;
  return ats === 'ashby' ? jobs.filter((j) => (j as { isListed?: unknown })?.isListed !== false).length : jobs.length;
}

const fixturePath = (root: string, tree: 'full' | 'mini', ats: Ats, token: string) =>
  join(root, 'fixtures', tree, ats, `${token}.json.gz`);

export async function recordBoards(opts: RecordOptions): Promise<RecordResult> {
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limiter = createHostLimiter({ minIntervalMs: opts.minIntervalMs ?? 1000, sleep });
  const dropped: Dropped[] = [];
  const kept: { cand: Candidate; body: unknown; raw: Buffer; status: number; postings: number }[] = [];

  const seen = new Set<string>();
  const unique = opts.candidates.filter((c) => {
    const k = `${c.ats}:${c.token}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const attempt = (url: string): Promise<CappedResult> =>
    limiter.run(new URL(url).host, () =>
      fetchCapped(url, { fetch: opts.fetch, maxBytes: opts.maxBytes ?? MAX_BYTES, timeoutMs: opts.timeoutMs ?? TIMEOUT_MS }),
    );

  await Promise.all(
    unique.map(async (cand) => {
      const { ats, token } = cand;
      if (!TOKEN_RE.test(token)) return void dropped.push({ ats, token, reason: 'bad_token' });
      const url = listUrl(ats, token);
      let res = await attempt(url);
      const retryable = (r: CappedResult) =>
        r.kind === 'network' || (r.kind === 'http' && (r.status === 429 || r.status >= 500));
      if (retryable(res)) {
        const wait = res.kind === 'http' && res.retryAfterMs !== null ? Math.min(res.retryAfterMs, 30_000) : 2000;
        await sleep(wait);
        res = await attempt(url);
      }
      if (res.kind === 'http') return void dropped.push({ ats, token, reason: `http_${res.status}` });
      if (res.kind !== 'ok') return void dropped.push({ ats, token, reason: res.kind });
      let body: unknown;
      try {
        body = JSON.parse(res.bytes.toString('utf8'));
      } catch {
        return void dropped.push({ ats, token, reason: 'invalid_json' });
      }
      const postings = countPostings(ats, body);
      if (postings === null) return void dropped.push({ ats, token, reason: 'schema' });
      if (postings === 0) return void dropped.push({ ats, token, reason: 'empty' });
      kept.push({ cand, body, raw: res.bytes, status: res.status, postings });
    }),
  );

  kept.sort((a, b) => `${a.cand.ats}:${a.cand.token}`.localeCompare(`${b.cand.ats}:${b.cand.token}`));

  // Byte-exact bodies, gzipped.
  const gz = new Map<string, Buffer>();
  const k = (c: Candidate) => `${c.ats}:${c.token}`;
  for (const b of kept) gz.set(k(b.cand), gzipSync(b.raw, { level: 9 }));

  // Over budget: drop descriptions beyond the first 200 postings, largest boards first.
  const budget = opts.budgetBytes ?? TOTAL_BUDGET_BYTES;
  const total = () => [...gz.values()].reduce((s, v) => s + v.length, 0);
  const trimmed: RecordResult['trimmed'] = [];
  if (total() > budget) {
    const bySize = [...kept].sort((a, b) => gz.get(k(b.cand))!.length - gz.get(k(a.cand))!.length);
    for (const b of bySize) {
      if (total() <= budget) break;
      if (b.postings <= KEEP_FULL_DESCRIPTIONS) continue;
      const before = gz.get(k(b.cand))!.length;
      const after = gzipSync(JSON.stringify(trimDescriptions(b.cand.ats, b.body, KEEP_FULL_DESCRIPTIONS)), { level: 9 });
      gz.set(k(b.cand), after);
      trimmed.push({ ats: b.cand.ats, token: b.cand.token, gzBefore: before, gzAfter: after.length });
    }
  }

  for (const b of kept) {
    const p = fixturePath(opts.outDir, 'full', b.cand.ats, b.cand.token);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, gz.get(k(b.cand))!);
  }

  const mini = kept.length
    ? deriveMini(
        kept.map<KeptBoard>((b) => ({ ats: b.cand.ats, token: b.cand.token, gzBytes: gz.get(k(b.cand))!.length, postings: b.postings })),
      )
    : [];
  for (const m of mini) {
    const [ats, token] = m.split(':') as [Ats, string];
    const dst = fixturePath(opts.outDir, 'mini', ats, token);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(fixturePath(opts.outDir, 'full', ats, token), dst);
  }

  const verifiedAt = now().toISOString();
  const boards: RecordedBoard[] = kept.map((b) => ({
    name: b.cand.name,
    domain: b.cand.domain,
    ats: b.cand.ats,
    token: b.cand.token,
    hires_in_india: b.cand.hires_in_india,
    verified_at: verifiedAt,
    http_status: b.status,
    postings: b.postings,
  }));
  writeFileSync(join(opts.outDir, 'boards.json'), JSON.stringify(boards, null, 2) + '\n');

  const totalGzBytes = total();
  const result: RecordResult = {
    boards,
    dropped: dropped.sort((a, b) => `${a.ats}:${a.token}`.localeCompare(`${b.ats}:${b.token}`)),
    mini,
    trimmed,
    totalGzBytes,
    totalPostings: boards.reduce((s, b) => s + b.postings, 0),
  };
  mkdirSync(join(opts.outDir, 'fixtures/full'), { recursive: true });
  writeFileSync(
    join(opts.outDir, 'fixtures/full/manifest.json'),
    JSON.stringify(
      {
        recorded_at: verifiedAt,
        total_gz_bytes: totalGzBytes,
        total_postings: result.totalPostings,
        kept: boards.length,
        trimmed_note: `For boards listed in "trimmed", description fields beyond the first ${KEEP_FULL_DESCRIPTIONS} postings were blanked and the body re-serialised (not byte-exact).`,
        trimmed,
        mini,
        dropped: result.dropped,
      },
      null,
      2,
    ) + '\n',
  );
  return result;
}
