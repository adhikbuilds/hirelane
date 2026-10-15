/** Database reads for the list pages. Takes a client so tests can run against a scratch database. */
import type { ListDef } from "./lists";
import { facetKeyOf } from "./lists";
import type { Queryable } from "./queries/jobs";

/** Every list-relevant job_facets row as k -> n. */
export async function facetCounts(db: Queryable): Promise<Map<string, number>> {
  const { rows } = await db.query(
    `SELECT k, n FROM job_facets WHERE grain IN ('role_country', 'remote_role', 'salary_role')`,
  );
  return new Map(rows.map((r) => [r.k as string, Number(r.n)]));
}

/** Open-job count for one list from the materialized view; 0 when the row is absent. */
export async function facetCountFor(db: Queryable, def: ListDef): Promise<number> {
  const { rows } = await db.query(`SELECT n FROM job_facets WHERE k = $1`, [facetKeyOf(def)]);
  return rows[0] ? Number(rows[0].n) : 0;
}

/** Finish time of the latest ingest run that produced usable data. */
export async function latestSuccessfulRunAt(db: Queryable): Promise<Date | null> {
  const { rows } = await db.query(
    `SELECT max(finished_at) AS t FROM ingest_runs WHERE status IN ('ok', 'partial')`,
  );
  return rows[0]?.t ? new Date(rows[0].t) : null;
}
