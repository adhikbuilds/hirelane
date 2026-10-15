import "server-only";
import { withAdmin } from "@hirelane/db";
import { PAGE_SIZE, pageOffset } from "./ledger";

export type RunRow = {
  id: string;
  trigger: string;
  mode: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  boardsOk: number;
  boardsFailed: number;
  postingsNew: number;
  postingsChanged: number;
  postingsClosed: number;
};

export type SourceStat = {
  ats: string;
  boards: number;
  failed: number;
  fetched: number;
  new: number;
  changed: number;
  unchanged: number;
  closed: number;
};

export type BoardRunRow = {
  company: string;
  ats: string;
  status: string;
  httpStatus: number | null;
  fetched: number;
  new: number;
  changed: number;
  closed: number;
  durationMs: number;
  errorText: string | null;
};

export type IngestOverview = {
  runs: RunRow[];
  latestRunId: string | null;
  perSource: SourceStat[];
  boardRuns: BoardRunRow[];
  openPostings: number;
};

export async function getIngestOverview(): Promise<IngestOverview> {
  return withAdmin(async (db) => {
    const runs = (
      await db.query(
        `SELECT id, trigger, mode, started_at, finished_at, status, boards_ok, boards_failed,
                postings_new, postings_changed, postings_closed
           FROM ingest_runs ORDER BY started_at DESC LIMIT 10`,
      )
    ).rows.map(
      (r): RunRow => ({
        id: r.id,
        trigger: r.trigger,
        mode: r.mode,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        status: r.status,
        boardsOk: r.boards_ok,
        boardsFailed: r.boards_failed,
        postingsNew: r.postings_new,
        postingsChanged: r.postings_changed,
        postingsClosed: r.postings_closed,
      }),
    );
    const latestRunId = runs[0]?.id ?? null;
    const open = (await db.query("SELECT count(*)::int AS n FROM postings WHERE closed_at IS NULL")).rows[0].n as number;
    if (!latestRunId) return { runs, latestRunId, perSource: [], boardRuns: [], openPostings: open };

    const perSource = (
      await db.query(
        `SELECT b.ats, count(*)::int AS boards,
                count(*) FILTER (WHERE s.status = 'failed')::int AS failed,
                sum(s.fetched)::int AS fetched, sum(s.new)::int AS new, sum(s.changed)::int AS changed,
                sum(s.unchanged)::int AS unchanged, sum(s.closed)::int AS closed
           FROM ingest_source_runs s JOIN company_boards b ON b.id = s.board_id
          WHERE s.run_id = $1 GROUP BY b.ats ORDER BY b.ats`,
        [latestRunId],
      )
    ).rows as SourceStat[];

    const boardRuns = (
      await db.query(
        `SELECT c.name AS company, b.ats, s.status, s.http_status, s.fetched, s.new, s.changed, s.closed,
                s.duration_ms, s.error_text
           FROM ingest_source_runs s
           JOIN company_boards b ON b.id = s.board_id JOIN companies c ON c.id = b.company_id
          WHERE s.run_id = $1
          ORDER BY (s.status = 'ok') ASC, c.name LIMIT 200`,
        [latestRunId],
      )
    ).rows.map(
      (r): BoardRunRow => ({
        company: r.company,
        ats: r.ats,
        status: r.status,
        httpStatus: r.http_status,
        fetched: r.fetched,
        new: r.new,
        changed: r.changed,
        closed: r.closed,
        durationMs: r.duration_ms,
        errorText: r.error_text,
      }),
    );
    return { runs, latestRunId, perSource, boardRuns, openPostings: open };
  });
}

export type PostingRow = {
  id: string;
  title: string;
  company: string;
  where: string | null;
  postedAt: Date;
  ats: string;
  raw: unknown;
  url: string;
  jobSlug: string | null;
};

export async function getPostingsPage(page: number): Promise<{ rows: PostingRow[]; total: number }> {
  return withAdmin(async (db) => {
    const total = (await db.query("SELECT count(*)::int AS n FROM postings WHERE closed_at IS NULL")).rows[0].n as number;
    const rows = (
      await db.query(
        `SELECT p.id, p.title, c.name AS company, p.location_raw, p.raw, p.url, b.ats, j.slug AS job_slug,
                COALESCE(p.posted_at, p.first_seen_at) AS fresh_at
           FROM postings p
           JOIN company_boards b ON b.id = p.board_id JOIN companies c ON c.id = b.company_id
           LEFT JOIN jobs j ON j.id = p.job_id
          WHERE p.closed_at IS NULL
          ORDER BY fresh_at DESC, p.id LIMIT $1 OFFSET $2`,
        [PAGE_SIZE, pageOffset(page)],
      )
    ).rows.map(
      (r): PostingRow => ({
        id: r.id,
        title: r.title,
        company: r.company,
        where: r.location_raw,
        postedAt: r.fresh_at,
        ats: r.ats,
        raw: r.raw,
        url: r.url,
        jobSlug: r.job_slug,
      }),
    );
    return { rows, total };
  });
}
