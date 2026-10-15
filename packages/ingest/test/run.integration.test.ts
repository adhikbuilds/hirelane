import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, close, withAdmin } from '@hirelane/db';
import type { BoardConfig } from '../src/run/boards';
import { createFixtureFetch } from '../src/run/fixtures';
import { defaultRetryPolicy } from '../src/run/retry';
import { runIngest } from '../src/run/run';

// Own database so this file never fights the db package's tests over hirelane_test.
const BASE = process.env['TEST_DATABASE_URL'] ?? 'postgres://hirelane:hirelane@localhost:5433/hirelane_test';
const DB_NAME = 'hirelane_ingest_run_test';
const MINI = fileURLToPath(new URL('../fixtures/mini/', import.meta.url));
const MIGRATIONS = resolve(fileURLToPath(new URL('../../db/migrations', import.meta.url)));

const boards: BoardConfig[] = (
  [
    ['OpenAI', 'openai.com', 'ashby', 'openai'],
    ['Benchling', 'benchling.com', 'ashby', 'benchling'],
    ['Temporal', 'temporal.io', 'ashby', 'temporal'],
    ['Airtable', 'airtable.com', 'greenhouse', 'airtable'],
    ['CRED', 'cred.club', 'lever', 'cred'],
  ] as const
).map(([name, domain, ats, token]) => ({
  name, slug: name.toLowerCase(), domain, ats, token, hiresInIndia: false, verifiedAt: new Date('2026-10-15T00:00:00Z'),
}));

function url(db: string): string {
  const u = new URL(BASE);
  u.pathname = `/${db}`;
  return u.toString();
}

let dir: string;
const run = (inject: Record<string, number> = {}, fixtures = dir) =>
  runIngest({
    mode: 'fixture',
    trigger: 'fixture',
    boards,
    fetch: createFixtureFetch({ dir: fixtures, boards, inject }),
    retry: defaultRetryPolicy('fixture'),
    concurrency: 4,
  });

const openCount = async () =>
  withAdmin(async (c) => (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM postings WHERE closed_at IS NULL')).rows[0]!.n);

beforeAll(async () => {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(BASE)) throw new Error('refusing to run against a non-local database');
  process.env['DATABASE_URL'] = BASE;
  await withAdmin(async (c) => {
    const { rowCount } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME]);
    if (!rowCount) await c.query(`CREATE DATABASE ${DB_NAME}`);
  });
  await close();
  process.env['DATABASE_URL'] = url(DB_NAME);
  await withAdmin(async (c) => {
    await c.query('DROP SCHEMA public CASCADE');
    await c.query('CREATE SCHEMA public');
    await applyMigrations(c, MIGRATIONS);
  });
}, 60_000);

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ingest-run-'));
  cpSync(MINI, dir, { recursive: true });
  await withAdmin((c) => c.query('TRUNCATE ingest_runs, postings, company_boards, companies CASCADE'));
});

/** Drop the first listed posting of ashby:openai from the copied fixture; returns nothing, mutates `dir`. */
function dropOnePosting(): void {
  const p = join(dir, 'ashby', 'openai.json.gz');
  const body = JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as { jobs: unknown[] };
  body.jobs.shift();
  writeFileSync(p, gzipSync(JSON.stringify(body)));
}

describe('runIngest (fixture mode, mini fixtures)', () => {
  it('ingests every board and writes one source row per board with non-null counts', async () => {
    const s = await run();
    expect(s.boards).toBe(5);
    expect(s.boardsOk).toBe(5);
    expect(s.boardsFailed).toBe(0);
    expect(s.new).toBeGreaterThan(0);
    const rows = await withAdmin((c) =>
      c.query('SELECT * FROM ingest_source_runs WHERE run_id = $1', [s.runId]).then((r) => r.rows),
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      for (const col of ['fetched', 'new', 'changed', 'unchanged', 'closed', 'bytes', 'duration_ms']) expect(r[col]).not.toBeNull();
      expect(r.status).toBe('ok');
    }
    expect(await openCount()).toBe(s.new);
  });

  it('an immediate second run reports 0 new and 0 changed', async () => {
    await run();
    const s2 = await run();
    expect(s2).toMatchObject({ new: 0, changed: 0, closed: 0, boardsOk: 5 });
    expect(s2.unchanged).toBeGreaterThan(0);
  });

  it('closes exactly 1 posting after a removed posting is missed in two runs', async () => {
    const first = await run();
    dropOnePosting();
    const a = await run();
    expect(a.closed).toBe(0);
    const b = await run();
    expect(b.closed).toBe(1);
    expect(await openCount()).toBe(first.new - 1);
    const c = await run();
    expect(c.closed).toBe(0);
  });

  it('closes 0 postings when a board returns HTTP 500 across 3 runs, and records failed rows', async () => {
    const first = await run();
    for (let i = 0; i < 3; i++) {
      const s = await run({ 'ashby:openai': 500 });
      expect(s.closed).toBe(0);
      expect(s.boardsFailed).toBe(1);
      expect(s.boardsOk).toBe(4);
      expect(s.failures[0]).toMatchObject({ ats: 'ashby', token: 'openai' });
    }
    expect(await openCount()).toBe(first.new);
    const failed = await withAdmin((c) =>
      c.query("SELECT count(*)::int AS n FROM ingest_source_runs WHERE status = 'failed' AND http_status = 500").then((r) => r.rows[0].n),
    );
    expect(failed).toBe(3);
  });

  it('a board with no fixture file fails alone and closes nothing', async () => {
    await run();
    const s = await run({}, mkdtempSync(join(tmpdir(), 'empty-')));
    expect(s.boardsOk).toBe(0);
    expect(s.closed).toBe(0);
    expect(s.status).toBe('failed');
  });

  it('one run row per run and one source row per board per run', async () => {
    await run();
    await run();
    const r = await withAdmin((c) =>
      c.query('SELECT run_id, count(*)::int AS n, count(DISTINCT board_id)::int AS d FROM ingest_source_runs GROUP BY run_id').then((x) => x.rows),
    );
    expect(r).toHaveLength(2);
    for (const x of r) expect([x.n, x.d]).toEqual([5, 5]);
  });
});
