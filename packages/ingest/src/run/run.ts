/**
 * The ingest core shared by the CLI and the worker tasks. Boards come from config
 * (boards.json), are fetched through the connectors, normalised, and committed one board at a
 * time. A failed fetch records a failed source row and touches no posting.
 */
import {
  finalizeRun,
  recordSourceFailure,
  recordSourceSuccess,
  startRun,
  upsertCompanyBoard,
  withAdmin,
  type FinalizeResult,
} from '@hirelane/db';
import { connectors } from '../connectors';
import type { Ats, BoardFetch, BoardRef, FetchBoardError, IngestMode, NormalizedPosting, PostingSource } from '../contract';
import { normalize } from '../normalize';
import type { BoardConfig } from './boards';
import { fetchBoardWithRetry, type RetryPolicy } from './retry';

export type RunTrigger = 'cron' | 'manual' | 'fixture';

export interface SeededBoard extends BoardRef {
  config: BoardConfig;
}

export interface BoardOutcome {
  board: BoardRef;
  status: 'ok' | 'empty_suspect' | 'failed';
  attempts: number;
  fetched: number;
  new: number;
  changed: number;
  unchanged: number;
  error?: string;
}

export interface RunSummary extends FinalizeResult {
  runId: string;
  boards: number;
  fetched: number;
  new: number;
  changed: number;
  unchanged: number;
  elapsedMs: number;
  failures: { ats: Ats; token: string; error: string }[];
}

export function describeError(e: FetchBoardError): string {
  switch (e.kind) {
    case 'http': return `http ${e.status}`;
    case 'schema': return `schema: ${e.issues.join('; ')}`;
    case 'network': return `network: ${e.message}`;
    case 'invalid_json': return `invalid_json: ${e.message}`;
    case 'too_large': return `too_large (limit ${e.limitBytes} bytes)`;
    case 'rate_limited': return `rate_limited${e.retryAfterMs !== null ? ` (retry-after ${e.retryAfterMs} ms)` : ''}`;
    case 'fixture_missing': return `fixture_missing: ${e.path}`;
    default: return e.kind;
  }
}

/** Idempotent: ensures a company and board row for every configured board. */
export async function seedBoards(boards: BoardConfig[]): Promise<SeededBoard[]> {
  return withAdmin(async (client) => {
    const out: SeededBoard[] = [];
    for (const config of boards) {
      // db's seed type still lists the 3 ATS APIs; migration 0018 widened the column CHECK. Widen the type in
      // packages/db/src/ingest/persist.ts (outside this change's scope) and drop the cast.
      const { boardId } = await upsertCompanyBoard(client, {
        slug: config.slug, name: config.name, domain: config.domain,
        ats: config.ats as 'greenhouse' | 'lever' | 'ashby', token: config.token, verifiedAt: config.verifiedAt,
      });
      out.push({ id: boardId, ats: config.ats, token: config.token, config });
    }
    return out;
  });
}

/** Board ids for configured boards that already exist, in config order. */
export async function resolveBoardIds(boards: { ats: Ats; token: string }[]): Promise<string[]> {
  if (boards.length === 0) return [];
  return withAdmin(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT cb.id FROM company_boards cb
         JOIN unnest($1::text[], $2::text[]) AS c(ats, token) ON c.ats = cb.ats AND c.token = cb.token`,
      [boards.map((b) => b.ats), boards.map((b) => b.token)],
    );
    return rows.map((r) => r.id);
  });
}

export async function beginRun(mode: IngestMode, trigger: RunTrigger): Promise<string> {
  return withAdmin((client) => startRun(client, { trigger, mode }));
}

export interface IngestBoardOptions {
  runId: string;
  board: BoardRef;
  mode: IngestMode;
  fetch: BoardFetch;
  retry: RetryPolicy;
  signal?: AbortSignal;
}

/** Fetch, normalise and commit one board. Fetch failures are recorded, not thrown; DB errors throw. */
export async function ingestBoard(o: IngestBoardOptions): Promise<BoardOutcome> {
  const source: PostingSource = o.mode;
  const signal = o.signal ?? new AbortController().signal;
  const { result, attempts } = await fetchBoardWithRetry(
    connectors[o.board.ats],
    o.board.token,
    { mode: o.mode, fetch: o.fetch, signal },
    o.retry,
  );

  if (!result.ok) {
    // error_text can carry remote-influenced text (parser and network messages); keep it bounded.
    const error = describeError(result.error).slice(0, 300);
    await withAdmin((client) =>
      recordSourceFailure(client, {
        runId: o.runId, boardId: o.board.id, httpStatus: result.httpStatus, errorText: error, bytes: result.bytes, durationMs: result.durationMs,
      }),
    );
    return { board: o.board, status: 'failed', attempts, fetched: 0, new: 0, changed: 0, unchanged: 0, error };
  }

  const postings: NormalizedPosting[] = [];
  for (const raw of result.postings) {
    const n = normalize(o.board, raw, { source });
    if (n.ok) postings.push(n.posting);
  }
  const out = await withAdmin((client) =>
    recordSourceSuccess(client, {
      runId: o.runId, boardId: o.board.id, postings, seenExternalIds: result.seenExternalIds,
      httpStatus: result.httpStatus, bytes: result.bytes, durationMs: result.durationMs,
    }),
  );
  return {
    board: o.board, status: out.status, attempts, fetched: out.fetched, new: out.new, changed: out.changed, unchanged: out.unchanged,
    ...(out.status === 'empty_suspect' ? { error: 'empty listing for a board with open postings' } : {}),
  };
}

export async function completeRun(runId: string, expectedBoardIds: string[]): Promise<FinalizeResult> {
  return withAdmin((client) => finalizeRun(client, runId, { expectedBoardIds }));
}

export interface RunIngestOptions {
  mode: IngestMode;
  trigger?: RunTrigger;
  boards: BoardConfig[];
  fetch: BoardFetch;
  retry: RetryPolicy;
  concurrency?: number;
  signal?: AbortSignal;
  onBoard?: (o: BoardOutcome) => void;
}

/** Whole run in-process: seed, start, a bounded pool of boards, finalize. */
export async function runIngest(opts: RunIngestOptions): Promise<RunSummary> {
  const t0 = performance.now();
  const seeded = await seedBoards(opts.boards);
  const runId = await beginRun(opts.mode, opts.trigger ?? (opts.mode === 'fixture' ? 'fixture' : 'manual'));

  const outcomes: BoardOutcome[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const board = seeded[next++];
      if (!board) return;
      const outcome = await ingestBoard({
        runId, board, mode: opts.mode, fetch: opts.fetch, retry: opts.retry, ...(opts.signal ? { signal: opts.signal } : {}),
      });
      outcomes.push(outcome);
      opts.onBoard?.(outcome);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 6, seeded.length || 1)) }, worker));

  const fin = await completeRun(runId, seeded.map((b) => b.id));
  return {
    ...fin,
    runId,
    boards: seeded.length,
    new: fin.postingsNew,
    changed: fin.postingsChanged,
    fetched: outcomes.reduce((n, o) => n + o.fetched, 0),
    unchanged: outcomes.reduce((n, o) => n + o.unchanged, 0),
    elapsedMs: Math.round(performance.now() - t0),
    failures: outcomes.filter((o) => o.status !== 'ok').map((o) => ({ ats: o.board.ats, token: o.board.token, error: o.error ?? o.status })),
  };
}
