import "server-only";
import { withAdmin } from "@hirelane/db";
import { formatSalary } from "@/lib/job-view";

export type HeroJob = {
  slug: string;
  title: string;
  company: string;
  where: string;
  pay: string | null;
  freshAt: Date;
  ats: string;
};

export type LandingData = { jobs: HeroJob[]; refreshedAt: Date | null; boards: number };

/** Latest run that finished with at least some boards fetched. */
const LAST_GOOD_RUN = `SELECT finished_at, boards_ok, boards_failed FROM ingest_runs
                        WHERE status IN ('ok','partial') AND finished_at IS NOT NULL
                        ORDER BY finished_at DESC LIMIT 1`;

export async function getLandingData(limit = 12): Promise<LandingData> {
  return withAdmin(async (db) => {
    const run = (await db.query(LAST_GOOD_RUN)).rows[0] as { finished_at: Date; boards_ok: number } | undefined;
    const rows = (
      await db.query(
        `SELECT j.slug, j.title, j.workplace, j.countries, j.locations,
                j.salary_min_minor, j.salary_max_minor, j.salary_currency, j.salary_period,
                coalesce(j.posted_at, j.first_seen_at) AS fresh_at,
                c.name AS company_name, b.ats
           FROM jobs j
           JOIN companies c ON c.id = j.company_id
           LEFT JOIN postings p ON p.id = j.primary_posting_id
           LEFT JOIN company_boards b ON b.id = p.board_id
          WHERE j.closed_at IS NULL
          ORDER BY coalesce(j.posted_at, j.first_seen_at) DESC, j.id
          LIMIT $1`,
        [limit],
      )
    ).rows;
    let boards = run?.boards_ok ?? 0;
    if (run && boards === 0) {
      boards = Number(
        (await db.query(`SELECT count(DISTINCT p.board_id)::int AS n FROM postings p WHERE p.closed_at IS NULL`)).rows[0].n,
      );
    }
    const jobs = rows.map(
      (r): HeroJob => ({
        slug: r.slug,
        title: r.title,
        company: r.company_name,
        where: whereOf(r.countries, r.locations, r.workplace),
        pay: formatSalary({
          minMinor: r.salary_min_minor === null ? null : Number(r.salary_min_minor),
          maxMinor: r.salary_max_minor === null ? null : Number(r.salary_max_minor),
          currency: r.salary_currency,
          period: r.salary_period,
        }),
        freshAt: r.fresh_at,
        ats: r.ats ?? "",
      }),
    );
    return { jobs, refreshedAt: run?.finished_at ?? null, boards };
  });
}

function whereOf(countries: string[] | null, locations: string[] | null, workplace: string | null): string {
  const place = countries && countries.length > 0 ? countries.slice(0, 3).join(", ") : (locations?.[0] ?? "");
  const wp = workplace ? workplace[0]!.toUpperCase() + workplace.slice(1) : "";
  return [place, wp].filter(Boolean).join(" · ") || "Not stated";
}

export type StatusRun = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  boardsOk: number;
  boardsFailed: number;
  postingsNew: number;
  postingsChanged: number;
  postingsClosed: number;
};

export type StatusData = {
  runs: StatusRun[];
  lastGoodAt: Date | null;
  boardsOk: number;
  boardsFailed: number;
  openJobs: number;
  openPostings: number;
  perSource: { ats: string; boards: number; openPostings: number }[];
};

export async function getStatusData(): Promise<StatusData> {
  return withAdmin(async (db) => {
    const runs = (
      await db.query(
        `SELECT id, started_at, finished_at, status, boards_ok, boards_failed,
                postings_new, postings_changed, postings_closed
           FROM ingest_runs ORDER BY started_at DESC LIMIT 8`,
      )
    ).rows.map(
      (r): StatusRun => ({
        id: r.id,
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
    const good = (await db.query(LAST_GOOD_RUN)).rows[0] as
      | { finished_at: Date; boards_ok: number; boards_failed: number }
      | undefined;
    const openJobs = Number((await db.query(`SELECT count(*)::int AS n FROM jobs WHERE closed_at IS NULL`)).rows[0].n);
    const perSource = (
      await db.query(
        `SELECT b.ats, count(DISTINCT b.id)::int AS boards, count(p.id) FILTER (WHERE p.closed_at IS NULL)::int AS open_postings
           FROM company_boards b LEFT JOIN postings p ON p.board_id = b.id
          WHERE b.enabled GROUP BY b.ats ORDER BY b.ats`,
      )
    ).rows.map((r) => ({ ats: r.ats as string, boards: Number(r.boards), openPostings: Number(r.open_postings) }));
    return {
      runs,
      lastGoodAt: good?.finished_at ?? null,
      boardsOk: good?.boards_ok ?? 0,
      boardsFailed: good?.boards_failed ?? 0,
      openJobs,
      openPostings: perSource.reduce((a, s) => a + s.openPostings, 0),
      perSource,
    };
  });
}
