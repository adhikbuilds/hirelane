import type { Client, PoolClient } from 'pg';

type Queryable = Client | PoolClient;

/** Insertable/updatable posting columns. Mirrors `NormalizedPosting` in @hirelane/ingest (which imports this package). */
export interface PostingInput {
  externalId: string;
  key: string;
  url: string;
  applyUrl: string | null;
  title: string;
  locationRaw: string | null;
  raw: unknown;
  contentHash: string;
  postedAt: Date | null;
  source: 'live' | 'fixture';
}

export interface SourceSuccessInput {
  runId: string;
  boardId: string;
  /** Items that normalised cleanly. */
  postings: PostingInput[];
  /** Every listed item with an extractable id, including ones that failed to normalise. */
  seenExternalIds: string[];
  httpStatus: number | null;
  bytes: number;
  durationMs: number;
  now?: Date;
}

export interface SourceFailureInput {
  runId: string;
  boardId: string;
  httpStatus: number | null;
  errorText: string;
  bytes: number;
  durationMs: number;
  now?: Date;
}

export interface SourceOutcome {
  status: 'ok' | 'empty_suspect';
  fetched: number;
  new: number;
  changed: number;
  unchanged: number;
  /** True when the run/board pair was already committed OK, so nothing was applied. */
  skipped: boolean;
}

const CHUNK = 500;

async function tx<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const out = await fn();
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function startRun(
  client: Queryable,
  opts: { trigger: 'cron' | 'manual' | 'fixture'; mode: 'live' | 'fixture'; now?: Date },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'INSERT INTO ingest_runs (trigger, mode, started_at) VALUES ($1, $2, $3) RETURNING id',
    [opts.trigger, opts.mode, opts.now ?? new Date()],
  );
  return rows[0]!.id;
}

/**
 * Apply one SUCCESSFUL board fetch in a single transaction (the soft-close transition).
 * Idempotent per (run, board): a replay after an OK commit applies nothing.
 */
export async function recordSourceSuccess(
  client: Queryable,
  input: SourceSuccessInput,
): Promise<SourceOutcome> {
  const now = input.now ?? new Date();
  const { runId, boardId } = input;

  return tx(client, async () => {
    const ins = await client.query(
      `INSERT INTO ingest_source_runs (run_id, board_id, status) VALUES ($1, $2, 'running')
       ON CONFLICT (run_id, board_id) DO NOTHING`,
      [runId, boardId],
    );
    const inserted = (ins.rowCount ?? 0) === 1;
    const prior = await client.query<{
      status: string;
      fetched: number;
      new: number;
      changed: number;
      unchanged: number;
    }>(
      'SELECT status, fetched, new, changed, unchanged FROM ingest_source_runs WHERE run_id = $1 AND board_id = $2 FOR UPDATE',
      [runId, boardId],
    );
    const p = prior.rows[0]!;
    if (p.status === 'ok' || p.status === 'empty_suspect') {
      return {
        status: p.status,
        fetched: p.fetched,
        new: p.new,
        changed: p.changed,
        unchanged: p.unchanged,
        skipped: true,
      };
    }
    const wasFailed = !inserted && p.status === 'failed';

    const seen = new Set(input.seenExternalIds);
    const byId = new Map<string, PostingInput>();
    for (const posting of input.postings) {
      seen.add(posting.externalId);
      if (!byId.has(posting.externalId)) byId.set(posting.externalId, posting);
    }
    const seenIds = [...seen];

    const open = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM postings WHERE board_id = $1 AND closed_at IS NULL',
      [boardId],
    );

    // Empty-board guard: an outage that answers 200 with no jobs must never wipe a board.
    if (seenIds.length === 0 && open.rows[0]!.n >= 1) {
      await client.query(
        `UPDATE ingest_source_runs SET status = 'empty_suspect', http_status = $3, bytes = $4,
                duration_ms = $5, error_text = 'empty listing for a board with open postings', updated_at = $6
          WHERE run_id = $1 AND board_id = $2`,
        [runId, boardId, input.httpStatus, input.bytes, input.durationMs, now],
      );
      if (!wasFailed) await bumpFailures(client, boardId, now);
      return { status: 'empty_suspect', fetched: 0, new: 0, changed: 0, unchanged: 0, skipped: false };
    }

    const existing = await client.query<{
      external_id: string;
      content_hash: string;
      closed_at: Date | null;
    }>(
      `SELECT external_id, content_hash, closed_at FROM postings
        WHERE board_id = $1 AND external_id = ANY($2::text[])`,
      [boardId, seenIds],
    );
    const known = new Map(existing.rows.map((r) => [r.external_id, r]));

    const toWrite: PostingInput[] = [];
    const unchangedIds: string[] = [];
    let created = 0;
    let changed = 0;
    for (const [id, posting] of byId) {
      const row = known.get(id);
      if (!row) {
        created++;
        toWrite.push(posting);
      } else if (row.closed_at !== null || row.content_hash !== posting.contentHash) {
        changed++;
        toWrite.push(posting);
      } else {
        unchangedIds.push(id);
      }
    }
    // Seen but not normalised: keep alive without touching content.
    const touchOnly = [...unchangedIds, ...seenIds.filter((id) => !byId.has(id))];

    for (let i = 0; i < toWrite.length; i += CHUNK) {
      const chunk = toWrite.slice(i, i + CHUNK).map((x) => ({
        external_id: x.externalId,
        key: x.key,
        url: x.url,
        apply_url: x.applyUrl,
        title: x.title,
        location_raw: x.locationRaw,
        raw: x.raw,
        content_hash: x.contentHash,
        posted_at: x.postedAt ? x.postedAt.toISOString() : null,
        source: x.source,
      }));
      await client.query(
        `INSERT INTO postings (board_id, external_id, key, url, apply_url, title, location_raw, raw,
                               content_hash, posted_at, source, first_seen_at, last_seen_at, missed_runs)
         SELECT $1, x.external_id, x.key, x.url, x.apply_url, x.title, x.location_raw, x.raw,
                x.content_hash, x.posted_at, x.source, $3, $3, 0
           FROM jsonb_to_recordset($2::jsonb) AS x(external_id text, key text, url text, apply_url text,
                title text, location_raw text, raw jsonb, content_hash text, posted_at timestamptz, source text)
         ON CONFLICT (board_id, external_id) DO UPDATE SET
           key = EXCLUDED.key, url = EXCLUDED.url, apply_url = EXCLUDED.apply_url, title = EXCLUDED.title,
           location_raw = EXCLUDED.location_raw, raw = EXCLUDED.raw, content_hash = EXCLUDED.content_hash,
           posted_at = EXCLUDED.posted_at, source = EXCLUDED.source,
           last_seen_at = $3, missed_runs = 0, closed_at = NULL, updated_at = $3`,
        [boardId, JSON.stringify(chunk), now],
      );
    }

    if (touchOnly.length > 0) {
      await client.query(
        `UPDATE postings SET last_seen_at = $3, missed_runs = 0, updated_at = $3
          WHERE board_id = $1 AND external_id = ANY($2::text[]) AND closed_at IS NULL`,
        [boardId, touchOnly, now],
      );
    }

    await client.query(
      `UPDATE postings SET missed_runs = missed_runs + 1, updated_at = $3
        WHERE board_id = $1 AND closed_at IS NULL AND NOT (external_id = ANY($2::text[]))`,
      [boardId, seenIds, now],
    );

    await client.query(
      `UPDATE company_boards SET consecutive_failures = 0, last_success_at = $2, updated_at = $2 WHERE id = $1`,
      [boardId, now],
    );
    const unchanged = unchangedIds.length;
    await client.query(
      `UPDATE ingest_source_runs SET status = 'ok', http_status = $3, fetched = $4, new = $5, changed = $6,
              unchanged = $7, bytes = $8, duration_ms = $9, error_text = NULL, updated_at = $10
        WHERE run_id = $1 AND board_id = $2`,
      [runId, boardId, input.httpStatus, seenIds.length, created, changed, unchanged, input.bytes, input.durationMs, now],
    );
    return { status: 'ok', fetched: seenIds.length, new: created, changed, unchanged, skipped: false };
  });
}

async function bumpFailures(client: Queryable, boardId: string, now: Date): Promise<void> {
  await client.query(
    'UPDATE company_boards SET consecutive_failures = consecutive_failures + 1, updated_at = $2 WHERE id = $1',
    [boardId, now],
  );
}

/** A failed fetch touches no posting. It only records the source run and bumps the board's failure counter. */
export async function recordSourceFailure(
  client: Queryable,
  input: SourceFailureInput,
): Promise<void> {
  const now = input.now ?? new Date();
  await tx(client, async () => {
    const ins = await client.query(
      `INSERT INTO ingest_source_runs (run_id, board_id, status, http_status, bytes, duration_ms, error_text, created_at, updated_at)
       VALUES ($1, $2, 'failed', $3, $4, $5, $6, $7, $7)
       ON CONFLICT (run_id, board_id) DO NOTHING`,
      [input.runId, input.boardId, input.httpStatus, input.bytes, input.durationMs, input.errorText, now],
    );
    if ((ins.rowCount ?? 0) === 1) await bumpFailures(client, input.boardId, now);
  });
}

export interface FinalizeResult {
  status: 'ok' | 'partial' | 'failed';
  boardsOk: number;
  boardsFailed: number;
  postingsNew: number;
  postingsChanged: number;
  closed: number;
}

/**
 * Soft-close postings with 2 consecutive successful misses, attribute the closes to this run's
 * source rows, and roll the run's totals up. Boards in `expectedBoardIds` that never committed
 * are recorded as failed. Safe to call twice.
 */
export async function finalizeRun(
  client: Queryable,
  runId: string,
  opts: { now?: Date; expectedBoardIds?: string[] } = {},
): Promise<FinalizeResult> {
  const now = opts.now ?? new Date();
  return tx(client, async () => {
    if (opts.expectedBoardIds?.length) {
      const missing = await client.query<{ board_id: string }>(
        `INSERT INTO ingest_source_runs (run_id, board_id, status, error_text, created_at, updated_at)
         SELECT $1, b, 'failed', 'not committed before finalize cutoff', $3, $3
           FROM unnest($2::uuid[]) AS b
         ON CONFLICT (run_id, board_id) DO NOTHING
         RETURNING board_id`,
        [runId, opts.expectedBoardIds, now],
      );
      if (missing.rows.length > 0) {
        await client.query(
          `UPDATE company_boards SET consecutive_failures = consecutive_failures + 1, updated_at = $2
            WHERE id = ANY($1::uuid[])`,
          [missing.rows.map((r) => r.board_id), now],
        );
      }
    }

    const closedRows = await client.query<{ board_id: string; n: number }>(
      `WITH c AS (
         UPDATE postings SET closed_at = $1, updated_at = $1
          WHERE closed_at IS NULL AND missed_runs >= 2
          RETURNING board_id)
       SELECT board_id, count(*)::int AS n FROM c GROUP BY board_id`,
      [now],
    );
    for (const r of closedRows.rows) {
      await client.query(
        `UPDATE ingest_source_runs SET closed = closed + $3, updated_at = $4
          WHERE run_id = $1 AND board_id = $2`,
        [runId, r.board_id, r.n, now],
      );
    }

    const { rows } = await client.query<{
      ok: number;
      failed: number;
      n: number;
      c: number;
      cl: number;
    }>(
      `SELECT count(*) FILTER (WHERE status = 'ok')::int AS ok,
              count(*) FILTER (WHERE status IN ('failed', 'empty_suspect'))::int AS failed,
              coalesce(sum(new), 0)::int AS n, coalesce(sum(changed), 0)::int AS c,
              coalesce(sum(closed), 0)::int AS cl
         FROM ingest_source_runs WHERE run_id = $1`,
      [runId],
    );
    const t = rows[0]!;
    const status = t.failed === 0 ? 'ok' : t.ok === 0 ? 'failed' : 'partial';
    await client.query(
      `UPDATE ingest_runs SET finished_at = coalesce(finished_at, $2), status = $3, boards_ok = $4,
              boards_failed = $5, postings_new = $6, postings_changed = $7, postings_closed = $8, updated_at = $2
        WHERE id = $1`,
      [runId, now, status, t.ok, t.failed, t.n, t.c, t.cl],
    );
    return {
      status,
      boardsOk: t.ok,
      boardsFailed: t.failed,
      postingsNew: t.n,
      postingsChanged: t.c,
      closed: t.cl,
    };
  });
}

/** Operator action for a board that genuinely emptied: close everything still open. Returns the count. */
export async function closeBoard(client: Queryable, boardId: string, now = new Date()): Promise<number> {
  const res = await client.query(
    `UPDATE postings SET closed_at = $2, updated_at = $2 WHERE board_id = $1 AND closed_at IS NULL`,
    [boardId, now],
  );
  return res.rowCount ?? 0;
}

export interface BoardSeed {
  slug: string;
  name: string;
  domain: string | null;
  ats: 'greenhouse' | 'lever' | 'ashby';
  token: string;
  verifiedAt?: Date | null;
}

/** Idempotent on (ats, token) for the board and on slug for the company. */
export async function upsertCompanyBoard(
  client: Queryable,
  seed: BoardSeed,
): Promise<{ companyId: string; boardId: string }> {
  const company = await client.query<{ id: string }>(
    `INSERT INTO companies (slug, name, domain) VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, domain = coalesce(EXCLUDED.domain, companies.domain), updated_at = now()
     RETURNING id`,
    [seed.slug, seed.name, seed.domain],
  );
  const companyId = company.rows[0]!.id;
  const board = await client.query<{ id: string }>(
    `INSERT INTO company_boards (company_id, ats, token, verified_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (ats, token) DO UPDATE SET company_id = EXCLUDED.company_id,
       verified_at = coalesce(EXCLUDED.verified_at, company_boards.verified_at), updated_at = now()
     RETURNING id`,
    [companyId, seed.ats, seed.token, seed.verifiedAt ?? null],
  );
  return { companyId, boardId: board.rows[0]!.id };
}
