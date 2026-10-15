import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeBoard,
  finalizeRun,
  recordSourceFailure,
  recordSourceSuccess,
  startRun,
  upsertCompanyBoard,
  type PostingInput,
} from '../src/ingest/index.js';
import { applyMigrations } from '../src/migrator.js';
import { findSchemaDrift } from '../src/verify-schema-lib.js';
import { freshTestClient } from './helpers.js';

let client: Client;
let boardId: string;

function posting(id: string, over: Partial<PostingInput> = {}): PostingInput {
  return {
    externalId: id,
    key: `ashby:acme:${id}`,
    url: `https://jobs.example.com/acme/${id}`,
    applyUrl: null,
    title: `Role ${id}`,
    locationRaw: 'Remote',
    raw: { id },
    contentHash: `v1:hash-${id}`,
    postedAt: null,
    source: 'fixture',
    ...over,
  };
}

const T = (n: number) => new Date(Date.UTC(2026, 0, 1, n));

/** One full run: source commit for the board, then finalize. */
async function runOk(ids: string[], over: Record<string, Partial<PostingInput>> = {}, at = 0) {
  const runId = await startRun(client, { trigger: 'fixture', mode: 'fixture', now: T(at) });
  const out = await recordSourceSuccess(client, {
    runId,
    boardId,
    postings: ids.map((i) => posting(i, over[i])),
    seenExternalIds: ids,
    httpStatus: 200,
    bytes: 100,
    durationMs: 5,
    now: T(at),
  });
  const fin = await finalizeRun(client, runId, { now: T(at) });
  return { runId, out, fin };
}

async function runFail(at = 0, status: number | null = 500) {
  const runId = await startRun(client, { trigger: 'fixture', mode: 'fixture', now: T(at) });
  await recordSourceFailure(client, {
    runId,
    boardId,
    httpStatus: status,
    errorText: 'http 500',
    bytes: 0,
    durationMs: 3,
    now: T(at),
  });
  const fin = await finalizeRun(client, runId, { now: T(at) });
  return { runId, fin };
}

async function row(externalId: string) {
  const { rows } = await client.query(
    'SELECT * FROM postings WHERE board_id = $1 AND external_id = $2',
    [boardId, externalId],
  );
  return rows[0];
}

describe('ingest persistence', () => {
  beforeAll(async () => {
    client = await freshTestClient();
    await applyMigrations(client, resolve(import.meta.dirname, '../migrations'));
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query('TRUNCATE postings, ingest_source_runs, ingest_runs, company_boards, companies CASCADE');
    ({ boardId } = await upsertCompanyBoard(client, {
      slug: 'acme',
      name: 'Acme',
      domain: 'acme.example',
      ats: 'ashby',
      token: 'acme',
    }));
  });

  it('keeps the Drizzle schema in step with the migrations', async () => {
    expect(await findSchemaDrift(client)).toEqual([]);
  });

  it('inserts new postings with first/last seen and zero missed runs', async () => {
    const { out } = await runOk(['a', 'b'], {}, 1);
    expect(out).toMatchObject({ status: 'ok', fetched: 2, new: 2, changed: 0, unchanged: 0 });
    const a = await row('a');
    expect(a.first_seen_at).toEqual(T(1));
    expect(a.last_seen_at).toEqual(T(1));
    expect(a.missed_runs).toBe(0);
    expect(a.closed_at).toBeNull();
    expect(a.source).toBe('fixture');
  });

  it('an immediate identical second run reports 0 new, 0 changed, 0 closed', async () => {
    await runOk(['a', 'b'], {}, 1);
    const { out, fin } = await runOk(['a', 'b'], {}, 2);
    expect(out).toMatchObject({ new: 0, changed: 0, unchanged: 2 });
    expect(fin.closed).toBe(0);
    const a = await row('a');
    expect(a.first_seen_at).toEqual(T(1));
    expect(a.last_seen_at).toEqual(T(2));
  });

  it('counts a content_hash change as changed and rewrites the row', async () => {
    await runOk(['a', 'b'], {}, 1);
    const { out } = await runOk(['a', 'b'], { a: { contentHash: 'v1:new', title: 'Renamed' } }, 2);
    expect(out).toMatchObject({ new: 0, changed: 1, unchanged: 1 });
    const a = await row('a');
    expect(a.title).toBe('Renamed');
    expect(a.content_hash).toBe('v1:new');
    expect(a.first_seen_at).toEqual(T(1));
  });

  it('closes a posting after exactly 2 consecutive successful misses', async () => {
    await runOk(['a', 'b'], {}, 1);
    const r1 = await runOk(['a'], {}, 2);
    expect((await row('b')).missed_runs).toBe(1);
    expect((await row('b')).closed_at).toBeNull();
    expect(r1.fin.closed).toBe(0);
    const r2 = await runOk(['a'], {}, 3);
    expect((await row('b')).missed_runs).toBe(2);
    expect((await row('b')).closed_at).toEqual(T(3));
    expect(r2.fin.closed).toBe(1);
    expect((await row('a')).closed_at).toBeNull();
  });

  it('attributes closes to the source run and the ingest run', async () => {
    await runOk(['a', 'b'], {}, 1);
    await runOk(['a'], {}, 2);
    const { runId } = await runOk(['a'], {}, 3);
    const sr = await client.query('SELECT closed FROM ingest_source_runs WHERE run_id = $1', [runId]);
    expect(sr.rows[0].closed).toBe(1);
    const ir = await client.query('SELECT postings_closed, boards_ok FROM ingest_runs WHERE id = $1', [runId]);
    expect(ir.rows[0]).toMatchObject({ postings_closed: 1, boards_ok: 1 });
  });

  it('a reappearing posting resets missed_runs', async () => {
    await runOk(['a', 'b'], {}, 1);
    await runOk(['a'], {}, 2);
    const { out } = await runOk(['a', 'b'], {}, 3);
    expect(out).toMatchObject({ new: 0, unchanged: 2 });
    expect((await row('b')).missed_runs).toBe(0);
    await runOk(['a'], {}, 4);
    expect((await row('b')).closed_at).toBeNull();
  });

  it('reopens a closed posting that comes back, counted as changed', async () => {
    await runOk(['a', 'b'], {}, 1);
    await runOk(['a'], {}, 2);
    await runOk(['a'], {}, 3);
    expect((await row('b')).closed_at).not.toBeNull();
    const { out } = await runOk(['a', 'b'], {}, 4);
    expect(out).toMatchObject({ new: 0, changed: 1, unchanged: 1 });
    const b = await row('b');
    expect(b.closed_at).toBeNull();
    expect(b.missed_runs).toBe(0);
  });

  it('HTTP 500 across 3 runs closes nothing and leaves missed_runs alone', async () => {
    await runOk(['a', 'b'], {}, 1);
    await runOk(['a'], {}, 2); // b: missed_runs = 1
    for (const n of [3, 4, 5]) {
      const { fin } = await runFail(n);
      expect(fin.closed).toBe(0);
    }
    const b = await row('b');
    expect(b.missed_runs).toBe(1);
    expect(b.closed_at).toBeNull();
    expect((await row('a')).last_seen_at).toEqual(T(2));
    const { rows } = await client.query('SELECT consecutive_failures FROM company_boards WHERE id = $1', [boardId]);
    expect(rows[0].consecutive_failures).toBe(3);
  });

  it('failures are transparent to the consecutive-success count', async () => {
    await runOk(['a', 'b'], {}, 1);
    await runOk(['a'], {}, 2);
    await runFail(3);
    expect((await row('b')).closed_at).toBeNull();
    await runOk(['a'], {}, 4);
    expect((await row('b')).closed_at).toEqual(T(4));
  });

  it('a successful fetch resets consecutive_failures and stamps last_success_at', async () => {
    await runFail(1);
    await runFail(2);
    await runOk(['a'], {}, 3);
    const { rows } = await client.query('SELECT consecutive_failures, last_success_at FROM company_boards WHERE id = $1', [boardId]);
    expect(rows[0].consecutive_failures).toBe(0);
    expect(rows[0].last_success_at).toEqual(T(3));
  });

  it('treats an empty 2xx for a board with open postings as a failed fetch', async () => {
    await runOk(['a', 'b'], {}, 1);
    const runId = await startRun(client, { trigger: 'fixture', mode: 'fixture', now: T(2) });
    const out = await recordSourceSuccess(client, { runId, boardId, postings: [], seenExternalIds: [], httpStatus: 200, bytes: 12, durationMs: 1, now: T(2) });
    expect(out.status).toBe('empty_suspect');
    await finalizeRun(client, runId, { now: T(2) });
    expect((await row('a')).missed_runs).toBe(0);
    const { rows } = await client.query('SELECT consecutive_failures FROM company_boards WHERE id = $1', [boardId]);
    expect(rows[0].consecutive_failures).toBe(1);
    const ir = await client.query('SELECT status, boards_failed FROM ingest_runs WHERE id = $1', [runId]);
    expect(ir.rows[0]).toMatchObject({ status: 'failed', boards_failed: 1 });
  });

  it('accepts an empty 2xx for a board with nothing open', async () => {
    const { out } = await runOk([], {}, 1);
    expect(out.status).toBe('ok');
  });

  it('an item that failed to normalize stays seen and is never closed', async () => {
    await runOk(['a', 'b'], {}, 1);
    for (const n of [2, 3, 4]) {
      const runId = await startRun(client, { trigger: 'fixture', mode: 'fixture', now: T(n) });
      await recordSourceSuccess(client, { runId, boardId, postings: [posting('a')], seenExternalIds: ['a', 'b'], httpStatus: 200, bytes: 1, durationMs: 1, now: T(n) });
      await finalizeRun(client, runId, { now: T(n) });
    }
    const b = await row('b');
    expect(b.closed_at).toBeNull();
    expect(b.missed_runs).toBe(0);
    expect(b.last_seen_at).toEqual(T(4));
  });

  it('replaying the same source commit (worker retry) does not double-increment', async () => {
    await runOk(['a', 'b'], {}, 1);
    const runId = await startRun(client, { trigger: 'fixture', mode: 'fixture', now: T(2) });
    const input = { runId, boardId, postings: [posting('a')], seenExternalIds: ['a'], httpStatus: 200, bytes: 1, durationMs: 1, now: T(2) };
    const first = await recordSourceSuccess(client, input);
    const second = await recordSourceSuccess(client, input);
    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(second).toMatchObject({ new: first.new, changed: first.changed, unchanged: first.unchanged });
    expect((await row('b')).missed_runs).toBe(1);
    const { rows } = await client.query('SELECT count(*)::int AS n FROM ingest_source_runs WHERE run_id = $1', [runId]);
    expect(rows[0].n).toBe(1);
  });

  it('replaying a failure does not double-count consecutive_failures', async () => {
    const runId = await startRun(client, { trigger: 'fixture', mode: 'fixture', now: T(1) });
    const input = { runId, boardId, httpStatus: 500, errorText: 'x', bytes: 0, durationMs: 1, now: T(1) };
    await recordSourceFailure(client, input);
    await recordSourceFailure(client, input);
    const { rows } = await client.query('SELECT consecutive_failures FROM company_boards WHERE id = $1', [boardId]);
    expect(rows[0].consecutive_failures).toBe(1);
  });

  it('writes one non-null source run per board per run, including failed ones', async () => {
    const other = await upsertCompanyBoard(client, { slug: 'beta', name: 'Beta', domain: null, ats: 'lever', token: 'beta' });
    const runId = await startRun(client, { trigger: 'fixture', mode: 'fixture', now: T(1) });
    await recordSourceSuccess(client, { runId, boardId, postings: [posting('a')], seenExternalIds: ['a'], httpStatus: 200, bytes: 50, durationMs: 7, now: T(1) });
    await recordSourceFailure(client, { runId, boardId: other.boardId, httpStatus: 404, errorText: 'not_found', bytes: 0, durationMs: 2, now: T(1) });
    await finalizeRun(client, runId, { now: T(1) });
    const { rows } = await client.query('SELECT * FROM ingest_source_runs WHERE run_id = $1 ORDER BY status', [runId]);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      for (const k of ['fetched', 'new', 'changed', 'unchanged', 'closed', 'bytes', 'duration_ms']) {
        expect(r[k]).not.toBeNull();
      }
    }
    expect(rows.map((r) => r.status)).toEqual(['failed', 'ok']);
    const ir = await client.query('SELECT status, boards_ok, boards_failed, postings_new, finished_at FROM ingest_runs WHERE id = $1', [runId]);
    expect(ir.rows[0]).toMatchObject({ status: 'partial', boards_ok: 1, boards_failed: 1, postings_new: 1 });
    expect(ir.rows[0].finished_at).not.toBeNull();
  });

  it('finalize records a board that never committed as failed', async () => {
    const runId = await startRun(client, { trigger: 'cron', mode: 'live', now: T(1) });
    await finalizeRun(client, runId, { now: T(1), expectedBoardIds: [boardId] });
    const { rows } = await client.query('SELECT status, error_text FROM ingest_source_runs WHERE run_id = $1', [runId]);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error_text).toMatch(/finalize/);
    const b = await client.query('SELECT consecutive_failures FROM company_boards WHERE id = $1', [boardId]);
    expect(b.rows[0].consecutive_failures).toBe(1);
  });

  it('finalize is idempotent', async () => {
    await runOk(['a', 'b'], {}, 1);
    await runOk(['a'], {}, 2);
    const { runId, fin } = await runOk(['a'], {}, 3);
    expect(fin.closed).toBe(1);
    const again = await finalizeRun(client, runId, { now: T(4) });
    expect(again.closed).toBe(1);
    const ir = await client.query('SELECT postings_closed FROM ingest_runs WHERE id = $1', [runId]);
    expect(ir.rows[0].postings_closed).toBe(1);
  });

  it('operator closeBoard closes every open posting of a board', async () => {
    await runOk(['a', 'b'], {}, 1);
    const n = await closeBoard(client, boardId, T(9));
    expect(n).toBe(2);
    expect((await row('a')).closed_at).toEqual(T(9));
  });

  it('upsertCompanyBoard is idempotent on (ats, token)', async () => {
    const again = await upsertCompanyBoard(client, { slug: 'acme', name: 'Acme Inc', domain: 'acme.example', ats: 'ashby', token: 'acme' });
    expect(again.boardId).toBe(boardId);
    const { rows } = await client.query('SELECT count(*)::int AS n FROM companies');
    expect(rows[0].n).toBe(1);
  });

  it('handles a large board in one transaction', async () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `id${i}`);
    const { out } = await runOk(ids, {}, 1);
    expect(out.new).toBe(5000);
    const again = await runOk(ids, {}, 2);
    expect(again.out).toMatchObject({ new: 0, changed: 0, unchanged: 5000 });
  });

  it('stores special characters and raw json untouched', async () => {
    await runOk(['u'], { u: { title: "Ingénieur 🚀 ' ; DROP TABLE postings; --", raw: { nested: { a: [1, null, 'ü'] } } } }, 1);
    const u = await row('u');
    expect(u.title).toBe("Ingénieur 🚀 ' ; DROP TABLE postings; --");
    expect(u.raw).toEqual({ nested: { a: [1, null, 'ü'] } });
  });
});
