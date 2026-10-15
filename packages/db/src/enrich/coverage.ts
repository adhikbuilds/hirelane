import type { Client, PoolClient } from 'pg';

type Queryable = Client | PoolClient;

export interface CoverageStats {
  openJobs: number;
  withSalary: number;
  /** Pay stated anywhere (structured comp or a salary cue in the text), parsed or not. */
  salaryStatedAnywhere: number;
  salaryAmongStated: number;
  salaryWithoutTrace: number;
  withMustRequirement: number;
  withGeo: number;
  withRoleFamily: number;
  workplaceKnown: number;
  levelKnown: number;
  postings: { total: number; open: number; linked: number; openUnlinked: number };
  clusters: { jobsWithMultiplePostings: number; mergedPostings: number };
  llmCalls: number;
}

/** Everything report:coverage prints, in a single round trip. Open jobs only. */
export async function coverageStats(client: Queryable): Promise<CoverageStats> {
  const { rows } = await client.query(`
    WITH o AS (SELECT * FROM jobs WHERE closed_at IS NULL)
    SELECT
      (SELECT count(*) FROM o)::int AS open_jobs,
      (SELECT count(*) FROM o WHERE salary_min_minor IS NOT NULL OR salary_max_minor IS NOT NULL)::int AS with_salary,
      (SELECT count(*) FROM o WHERE salary_stated OR salary_min_minor IS NOT NULL OR salary_max_minor IS NOT NULL)::int AS stated,
      (SELECT count(*) FROM o WHERE salary_stated AND (salary_min_minor IS NOT NULL OR salary_max_minor IS NOT NULL))::int AS among_stated,
      (SELECT count(*) FROM o WHERE (salary_min_minor IS NOT NULL OR salary_max_minor IS NOT NULL) AND salary_trace IS NULL)::int AS no_trace,
      (SELECT count(*) FROM o WHERE EXISTS (SELECT 1 FROM job_requirements r WHERE r.job_id = o.id AND r.kind = 'must'))::int AS must_req,
      (SELECT count(*) FROM o WHERE cardinality(countries) > 0 OR remote_scope = 'worldwide')::int AS geo,
      (SELECT count(*) FROM o WHERE role_family IS NOT NULL)::int AS role_family,
      (SELECT count(*) FROM o WHERE workplace IS NOT NULL)::int AS workplace,
      (SELECT count(*) FROM o WHERE level IS NOT NULL)::int AS level,
      (SELECT count(*) FROM postings)::int AS p_total,
      (SELECT count(*) FROM postings WHERE closed_at IS NULL)::int AS p_open,
      (SELECT count(*) FROM postings WHERE job_id IS NOT NULL)::int AS p_linked,
      (SELECT count(*) FROM postings WHERE closed_at IS NULL AND job_id IS NULL)::int AS p_open_unlinked,
      (SELECT count(*) FROM (SELECT job_id FROM postings WHERE job_id IS NOT NULL GROUP BY job_id HAVING count(*) > 1) m)::int AS multi,
      (SELECT coalesce(sum(n - 1), 0) FROM (SELECT count(*) AS n FROM postings WHERE job_id IS NOT NULL GROUP BY job_id HAVING count(*) > 1) m)::int AS merged,
      (SELECT count(*) FROM llm_calls)::int AS llm_calls`);
  const r = rows[0];
  return {
    openJobs: r.open_jobs,
    withSalary: r.with_salary,
    salaryStatedAnywhere: r.stated,
    salaryAmongStated: r.among_stated,
    salaryWithoutTrace: r.no_trace,
    withMustRequirement: r.must_req,
    withGeo: r.geo,
    withRoleFamily: r.role_family,
    workplaceKnown: r.workplace,
    levelKnown: r.level,
    postings: { total: r.p_total, open: r.p_open, linked: r.p_linked, openUnlinked: r.p_open_unlinked },
    clusters: { jobsWithMultiplePostings: r.multi, mergedPostings: r.merged },
    llmCalls: r.llm_calls,
  };
}
