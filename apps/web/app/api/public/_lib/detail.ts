import { htmlToMarkdown } from "../../../../lib/markdown";
import { toPublicJob, type PublicJob, type Queryable } from "../../../../lib/queries/jobs";

export type PublicJobDetail = PublicJob & {
  descriptionMd: string | null;
  requirements: { kind: "must" | "nice"; text: string; category: string; yearsMin: number | null; spanStart: number; spanEnd: number }[];
  salaryTrace: Record<string, unknown>[] | null;
  sources: { ats: "greenhouse" | "lever" | "ashby"; url: string }[];
  closedAt: string | null;
};

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,199}$/;

const DETAIL_SQL = `
SELECT coalesce(j.posted_at, j.first_seen_at) AS fresh_at, j.id, j.slug, j.title, j.role_family, j.level, j.workplace,
       j.employment, j.remote, j.remote_scope, j.countries, j.locations, j.visa, j.source,
       (SELECT coalesce(json_agg(json_build_object('id', s.id, 'label', s.label) ORDER BY u.ord), '[]'::json)
          FROM unnest(j.skills) WITH ORDINALITY AS u(id, ord) JOIN skills s ON s.id = u.id) AS skill_labels,
       j.salary_min_minor, j.salary_max_minor, j.salary_currency, j.salary_period, j.salary_kind, j.salary_source,
       j.salary_annual_usd_min, j.salary_annual_usd_max, j.salary_annual_inr_min, j.salary_annual_inr_max,
       to_char(j.fx_date, 'YYYY-MM-DD') AS fx_day, j.posted_at, j.first_seen_at, j.last_seen_at,
       c.slug AS company_slug, c.name AS company_name, c.logo_path, b.ats,
       j.description_md, j.salary_trace, j.closed_at,
       (SELECT coalesce(json_agg(json_build_object('kind', r.kind, 'text', r.text, 'category', r.category,
                                                   'yearsMin', r.years_min, 'spanStart', r.span_start, 'spanEnd', r.span_end)
                                 ORDER BY r.ord), '[]'::json)
          FROM job_requirements r WHERE r.job_id = j.id) AS requirements,
       (SELECT coalesce(json_agg(json_build_object('ats', sb.ats, 'url', coalesce(sp.apply_url, sp.url)) ORDER BY sp.first_seen_at, sp.id), '[]'::json)
          FROM postings sp JOIN company_boards sb ON sb.id = sp.board_id
         WHERE sp.job_id = j.id AND sp.closed_at IS NULL) AS sources
  FROM jobs j
  JOIN companies c      ON c.id = j.company_id
  LEFT JOIN postings p  ON p.id = j.primary_posting_id
  LEFT JOIN company_boards b ON b.id = p.board_id
 WHERE j.slug = $1`;

/** One job by slug, open or closed (closed jobs carry `closedAt`). Null when the slug does not exist. */
export async function getPublicJobDetail(client: Queryable, slug: string, origin: string): Promise<PublicJobDetail | null> {
  if (!SLUG_RE.test(slug)) return null;
  const { rows } = await client.query(DETAIL_SQL, [slug]);
  const r = rows[0];
  if (!r) return null;
  const trace = r.salary_trace as { steps?: unknown } | unknown[] | null;
  const steps = Array.isArray(trace) ? trace : trace && Array.isArray(trace.steps) ? trace.steps : null;
  return {
    ...toPublicJob(r, origin),
    // Employer content: always sanitised to markdown before it leaves the API (served with CORS *).
    descriptionMd: r.description_md ? htmlToMarkdown(r.description_md) || null : null,
    requirements: r.requirements,
    salaryTrace: steps as Record<string, unknown>[] | null,
    sources: r.sources,
    closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
  };
}
