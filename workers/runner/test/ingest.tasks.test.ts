import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCrontab } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { createIngestTasks, type IngestDeps } from '../src/tasks/ingest.js';
import { taskList } from '../src/tasks/index.js';

const cfg = (ats: string, token: string) => ({ name: token, slug: token, domain: null, ats, token, hiresInIndia: false, verifiedAt: new Date() });

function makeDeps(over: Partial<IngestDeps> = {}) {
  const addJob = vi.fn(async () => ({}));
  const deps: IngestDeps = {
    mode: () => 'fixture',
    loadBoards: () => [cfg('ashby', 'openai'), cfg('lever', 'cred')] as never,
    seedBoards: vi.fn(async (b: { ats: string; token: string }[]) => b.map((x, i) => ({ id: `b${i}`, ats: x.ats, token: x.token, config: x }))) as never,
    beginRun: vi.fn(async () => 'run1'),
    activeRunExists: vi.fn(async () => false),
    runStatus: vi.fn(async () => 'running'),
    sourceCommitted: vi.fn(async () => false),
    committedCount: vi.fn(async () => 0),
    ingestBoard: vi.fn(async ({ board }: { board: { id: string } }) => ({ board, status: 'ok', attempts: 1, fetched: 1, new: 1, changed: 0, unchanged: 0 })) as never,
    completeRun: vi.fn(async () => ({}) as never),
    buildFetch: () => (async () => new Response('x')) as never,
    now: () => 1_000_000,
    ...over,
  };
  const helpers = { addJob, logger: { info: vi.fn(), warn: vi.fn() } };
  return { deps, helpers, addJob };
}

describe('ingest:schedule', () => {
  it('starts a run, fans out one source job per board and one finalize job', async () => {
    const { deps, helpers, addJob } = makeDeps();
    const t = createIngestTasks(deps);
    await t['ingest:schedule']!({}, helpers as never);
    const calls = addJob.mock.calls as unknown as [string, Record<string, unknown>, Record<string, unknown>][];
    const sources = calls.filter((c) => c[0] === 'ingest:source');
    expect(sources).toHaveLength(2);
    expect(sources[0]![1]).toMatchObject({ runId: 'run1', boardId: 'b0', ats: 'ashby', token: 'openai', mode: 'fixture' });
    expect(sources[0]![2]['jobKey']).toBe('ingest:source:run1:b0');
    expect(sources[0]![2]['queueName']).toMatch(/^ingest-/);
    expect(sources[0]![2]['maxAttempts']).toBeGreaterThan(1);
    const fin = calls.filter((c) => c[0] === 'ingest:finalize');
    expect(fin).toHaveLength(1);
    expect(fin[0]![1]).toMatchObject({ runId: 'run1', boardIds: ['b0', 'b1'] });
    expect(fin[0]![2]['runAt']).toBeInstanceOf(Date);
  });

  it('skips when a recent run is still active', async () => {
    const { deps, helpers, addJob } = makeDeps({ activeRunExists: vi.fn(async () => true) });
    await createIngestTasks(deps)['ingest:schedule']!({}, helpers as never);
    expect(addJob).not.toHaveBeenCalled();
    expect(deps.beginRun).not.toHaveBeenCalled();
  });

  it('does nothing with no verified boards', async () => {
    const { deps, helpers, addJob } = makeDeps({ loadBoards: () => [] });
    await createIngestTasks(deps)['ingest:schedule']!({}, helpers as never);
    expect(addJob).not.toHaveBeenCalled();
  });
});

describe('ingest:source', () => {
  const payload = { runId: 'run1', boardId: 'b0', ats: 'ashby', token: 'openai', mode: 'fixture' };

  it('ingests the configured board', async () => {
    const { deps, helpers } = makeDeps();
    await createIngestTasks(deps)['ingest:source']!(payload, helpers as never);
    expect(deps.ingestBoard).toHaveBeenCalledOnce();
    const arg = (deps.ingestBoard as unknown as { mock: { calls: [{ runId: string; board: { id: string; token: string } }][] } }).mock.calls[0]![0];
    expect(arg).toMatchObject({ runId: 'run1', board: { id: 'b0', token: 'openai' } });
  });

  it('rejects a token that is not in config (no user-controlled URLs)', async () => {
    const { deps, helpers } = makeDeps();
    await expect(
      createIngestTasks(deps)['ingest:source']!({ ...payload, token: '../evil' }, helpers as never),
    ).rejects.toThrow(/not a configured board/);
    expect(deps.ingestBoard).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads', async () => {
    const { deps, helpers } = makeDeps();
    const t = createIngestTasks(deps)['ingest:source']!;
    await expect(t(null, helpers as never)).rejects.toThrow(/payload/);
    await expect(t({ ...payload, mode: 'x' }, helpers as never)).rejects.toThrow(/payload/);
    await expect(t({ ...payload, runId: 5 }, helpers as never)).rejects.toThrow(/payload/);
  });

  it('is idempotent: a board already committed for this run is skipped', async () => {
    const { deps, helpers } = makeDeps({ sourceCommitted: vi.fn(async () => true) });
    await createIngestTasks(deps)['ingest:source']!(payload, helpers as never);
    expect(deps.ingestBoard).not.toHaveBeenCalled();
  });

  it('skips when the run is no longer running', async () => {
    const { deps, helpers } = makeDeps({ runStatus: vi.fn(async () => 'ok') });
    await createIngestTasks(deps)['ingest:source']!(payload, helpers as never);
    expect(deps.ingestBoard).not.toHaveBeenCalled();
  });

  it('propagates unexpected errors so graphile retries with backoff', async () => {
    const { deps, helpers } = makeDeps({ ingestBoard: vi.fn(async () => { throw new Error('db down'); }) });
    await expect(createIngestTasks(deps)['ingest:source']!(payload, helpers as never)).rejects.toThrow('db down');
  });
});

describe('ingest:finalize', () => {
  const payload = { runId: 'run1', boardIds: ['b0', 'b1'], deadline: 1_000_000 + 600_000 };

  it('finalizes once every board has committed', async () => {
    const { deps, helpers, addJob } = makeDeps({ committedCount: vi.fn(async () => 2) });
    await createIngestTasks(deps)['ingest:finalize']!(payload, helpers as never);
    expect(deps.completeRun).toHaveBeenCalledWith('run1', ['b0', 'b1']);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('reschedules itself while boards are outstanding and before the deadline', async () => {
    const { deps, helpers, addJob } = makeDeps({ committedCount: vi.fn(async () => 1) });
    await createIngestTasks(deps)['ingest:finalize']!(payload, helpers as never);
    expect(deps.completeRun).not.toHaveBeenCalled();
    const [name, p, spec] = (addJob.mock.calls as unknown as [string, unknown, { runAt: Date }][])[0]!;
    expect(name).toBe('ingest:finalize');
    expect(p).toMatchObject(payload);
    expect(spec.runAt.getTime()).toBeGreaterThan(1_000_000);
  });

  it('finalizes at the deadline even with boards outstanding (they count as failed)', async () => {
    const { deps, helpers } = makeDeps({ committedCount: vi.fn(async () => 0), now: () => 2_000_000 });
    await createIngestTasks(deps)['ingest:finalize']!(payload, helpers as never);
    expect(deps.completeRun).toHaveBeenCalledWith('run1', ['b0', 'b1']);
  });

  it('does nothing when the run is already finalized', async () => {
    const { deps, helpers } = makeDeps({ runStatus: vi.fn(async () => 'ok'), committedCount: vi.fn(async () => 2) });
    await createIngestTasks(deps)['ingest:finalize']!(payload, helpers as never);
    expect(deps.completeRun).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads', async () => {
    const { deps, helpers } = makeDeps();
    await expect(createIngestTasks(deps)['ingest:finalize']!({ runId: 'r' }, helpers as never)).rejects.toThrow(/payload/);
  });
});

describe('registration', () => {
  it('registers the three tasks and crontab schedules ingest:schedule at 7 */6 * * *', () => {
    for (const n of ['ingest:schedule', 'ingest:source', 'ingest:finalize']) expect(Object.keys(taskList)).toContain(n);
    const items = parseCrontab(readFileSync(resolve(import.meta.dirname, '../crontab'), 'utf8'));
    const sched = items.find((i) => i.task === 'ingest:schedule');
    expect(sched).toBeDefined();
    const at = (hour: number, min: number) => sched!.match({ min, hour, date: 16, month: 10, dow: 5 });
    for (const h of [0, 6, 12, 18]) expect(at(h, 7)).toBe(true);
    expect(at(6, 8)).toBe(false);
    expect(at(5, 7)).toBe(false);
    for (const item of items) expect(Object.keys(taskList)).toContain(item.task);
  });
});
