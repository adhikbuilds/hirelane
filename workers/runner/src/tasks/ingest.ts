/**
 * Ingest worker tasks. `ingest:schedule` (cron) starts a run and fans out one `ingest:source`
 * job per verified board; `ingest:finalize` waits for them, then soft-closes and totals the run.
 * Board tokens are re-resolved from boards.json, never trusted from a payload.
 */
import type { Task, TaskList } from 'graphile-worker';
import { withAdmin } from '@hirelane/db';
import {
  beginRun,
  completeRun,
  createFixtureFetch,
  createPolicyFetch,
  defaultRetryPolicy,
  ingestBoard,
  loadBoardConfig,
  seedBoards,
  type BoardConfig,
} from '@hirelane/ingest/src/run/index';
import { connectors } from '@hirelane/ingest/src/connectors/index';
import { createHostLimiter } from '@hirelane/ingest/src/record/limiter';
import type { BoardFetch, IngestMode } from '@hirelane/ingest/src/contract';

export interface IngestDeps {
  mode: () => IngestMode;
  loadBoards: () => BoardConfig[];
  seedBoards: typeof seedBoards;
  beginRun: typeof beginRun;
  activeRunExists: () => Promise<boolean>;
  runStatus: (runId: string) => Promise<string | null>;
  sourceCommitted: (runId: string, boardId: string) => Promise<boolean>;
  committedCount: (runId: string) => Promise<number>;
  ingestBoard: typeof ingestBoard;
  completeRun: typeof completeRun;
  buildFetch: (mode: IngestMode, boards: BoardConfig[]) => BoardFetch;
  now: () => number;
}

const FINALIZE_POLL_MS = 15_000;
const FINALIZE_DEADLINE_MS = 45 * 60_000;
const ACTIVE_RUN_WINDOW = '2 hours';

// One limiter for the whole worker process: per-host spacing holds across concurrent source jobs.
const liveLimiter = createHostLimiter({ minIntervalMs: 1000 });

export const defaultDeps: IngestDeps = {
  mode: () => (process.env['HIRELANE_INGEST_MODE'] === 'live' ? 'live' : 'fixture'),
  loadBoards: () => loadBoardConfig(),
  seedBoards,
  beginRun,
  activeRunExists: () =>
    withAdmin(async (c) => {
      const { rowCount } = await c.query(
        `SELECT 1 FROM ingest_runs WHERE status = 'running' AND started_at > now() - interval '${ACTIVE_RUN_WINDOW}' LIMIT 1`,
      );
      return (rowCount ?? 0) > 0;
    }),
  runStatus: (runId) =>
    withAdmin(async (c) => (await c.query<{ status: string }>('SELECT status FROM ingest_runs WHERE id = $1', [runId])).rows[0]?.status ?? null),
  sourceCommitted: (runId, boardId) =>
    withAdmin(async (c) => ((await c.query('SELECT 1 FROM ingest_source_runs WHERE run_id = $1 AND board_id = $2', [runId, boardId])).rowCount ?? 0) > 0),
  committedCount: (runId) =>
    withAdmin(async (c) => (await c.query<{ n: number }>('SELECT count(*)::int AS n FROM ingest_source_runs WHERE run_id = $1', [runId])).rows[0]!.n),
  ingestBoard,
  completeRun,
  buildFetch: (mode, boards) =>
    mode === 'fixture'
      ? createFixtureFetch({ boards })
      : createPolicyFetch({ rawFetch: (url, init) => fetch(url, { ...init, redirect: 'error' }), limiter: liveLimiter }),
  now: () => Date.now(),
};

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMode = (v: unknown): v is IngestMode => v === 'fixture' || v === 'live';

function bad(task: string): never {
  throw new Error(`${task}: invalid payload`);
}

export function createIngestTasks(deps: IngestDeps = defaultDeps): TaskList & Record<string, Task> {
  const schedule: Task = async (_payload, helpers) => {
    if (await deps.activeRunExists()) {
      helpers.logger.warn('ingest:schedule: a run is still active, skipping this tick');
      return;
    }
    const configs = deps.loadBoards();
    if (configs.length === 0) {
      helpers.logger.warn('ingest:schedule: no verified boards');
      return;
    }
    const mode = deps.mode();
    const seeded = await deps.seedBoards(configs);
    const runId = await deps.beginRun(mode, 'cron');
    for (const b of seeded) {
      await helpers.addJob(
        'ingest:source',
        { runId, boardId: b.id, ats: b.ats, token: b.token, mode },
        // One queue per ATS keeps same-host fetches serial; Postgres-level retry backs off exponentially.
        { jobKey: `ingest:source:${runId}:${b.id}`, queueName: `ingest-${b.ats}`, maxAttempts: 5 },
      );
    }
    await helpers.addJob(
      'ingest:finalize',
      { runId, boardIds: seeded.map((b) => b.id), deadline: deps.now() + FINALIZE_DEADLINE_MS },
      { jobKey: `ingest:finalize:${runId}`, runAt: new Date(deps.now() + FINALIZE_POLL_MS), maxAttempts: 5 },
    );
    helpers.logger.info(`ingest:schedule: run ${runId} mode=${mode} boards=${seeded.length}`);
  };

  const source: Task = async (payload, helpers) => {
    if (!isObj(payload) || !isStr(payload['runId']) || !isStr(payload['boardId']) || !isStr(payload['ats']) || !isStr(payload['token']) || !isMode(payload['mode'])) {
      return bad('ingest:source');
    }
    const { runId, boardId, ats, token, mode } = payload as { runId: string; boardId: string; ats: string; token: string; mode: IngestMode };
    const boards = deps.loadBoards();
    const config = boards.find((b) => b.ats === ats && b.token === token);
    if (!config) throw new Error(`ingest:source: ${ats}:${token} is not a configured board`);
    if ((await deps.runStatus(runId)) !== 'running') {
      helpers.logger.warn(`ingest:source: run ${runId} is not running, dropping ${ats}:${token}`);
      return;
    }
    if (await deps.sourceCommitted(runId, boardId)) return; // a retry after a committed attempt
    const outcome = await deps.ingestBoard({
      runId,
      board: { id: boardId, ats: config.ats, token: config.token },
      mode,
      fetch: deps.buildFetch(mode, boards),
      retry: defaultRetryPolicy(mode),
      ...(helpers.abortSignal ? { signal: helpers.abortSignal } : {}),
    });
    helpers.logger.info(`ingest:source: ${ats}:${token} ${outcome.status} new=${outcome.new} changed=${outcome.changed}`);
  };

  const finalize: Task = async (payload, helpers) => {
    if (
      !isObj(payload) || !isStr(payload['runId']) || typeof payload['deadline'] !== 'number' ||
      !Array.isArray(payload['boardIds']) || !payload['boardIds'].every(isStr)
    ) {
      return bad('ingest:finalize');
    }
    const { runId, boardIds, deadline } = payload as { runId: string; boardIds: string[]; deadline: number };
    if ((await deps.runStatus(runId)) !== 'running') return;
    const done = await deps.committedCount(runId);
    if (done < boardIds.length && deps.now() < deadline) {
      await helpers.addJob('ingest:finalize', payload, { runAt: new Date(deps.now() + FINALIZE_POLL_MS), maxAttempts: 5 });
      return;
    }
    const fin = await deps.completeRun(runId, boardIds);
    helpers.logger.info(`ingest:finalize: run ${runId} ${JSON.stringify(fin)}`);
  };

  return { 'ingest:schedule': schedule, 'ingest:source': source, 'ingest:finalize': finalize };
}
