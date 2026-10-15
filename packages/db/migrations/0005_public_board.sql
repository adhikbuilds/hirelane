-- 0005: public board support. search_text backs `q`, content_updated_at backs sitemaps and revalidation,
-- job_facets backs list thresholds and facet counts.
ALTER TABLE jobs ADD COLUMN search_text        text        NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN content_updated_at timestamptz NOT NULL DEFAULT now();

-- One definition of the searchable text. Writers call it explicitly (no trigger).
CREATE FUNCTION job_search_text(p_title text, p_company_id uuid, p_skills text[]) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT lower(concat_ws(' ',
           p_title,
           (SELECT c.name FROM companies c WHERE c.id = p_company_id),
           (SELECT string_agg(s.label || ' ' || s.id, ' ' ORDER BY s.id) FROM skills s WHERE s.id = ANY (p_skills))))
$$;

UPDATE jobs SET search_text = job_search_text(title, company_id, skills), content_updated_at = updated_at;

CREATE INDEX jobs_search_trgm ON jobs USING gin (search_text gin_trgm_ops) WHERE closed_at IS NULL;

-- One row per grain; k is a text surrogate key (REFRESH ... CONCURRENTLY needs a unique, NULL-free column index).
-- Multi-country jobs are counted once per (role, country) row via count(DISTINCT id) over the unnest.
CREATE MATERIALIZED VIEW job_facets AS
WITH open AS (
  SELECT id, role_family, countries, remote,
         (salary_min_minor IS NOT NULL OR salary_max_minor IS NOT NULL) AS has_salary
    FROM jobs
   WHERE closed_at IS NULL
)
SELECT g.grain || ':' || coalesce(g.role_family, '*') || ':' || coalesce(g.country, '*') AS k,
       g.grain, g.role_family, g.country, g.remote, g.has_salary, g.n
  FROM (
    SELECT 'all'::text AS grain, NULL::text AS role_family, NULL::text AS country,
           NULL::boolean AS remote, NULL::boolean AS has_salary, count(*)::int AS n FROM open
    UNION ALL SELECT 'role', role_family, NULL, NULL, NULL, count(*)::int
                FROM open WHERE role_family IS NOT NULL GROUP BY role_family
    UNION ALL SELECT 'country', NULL, c::text, NULL, NULL, count(DISTINCT id)::int
                FROM open, unnest(countries) c GROUP BY c
    UNION ALL SELECT 'role_country', role_family, c::text, NULL, NULL, count(DISTINCT id)::int
                FROM open, unnest(countries) c WHERE role_family IS NOT NULL GROUP BY role_family, c
    UNION ALL SELECT 'remote', NULL, NULL, true, NULL, count(*)::int FROM open WHERE remote
    UNION ALL SELECT 'remote_role', role_family, NULL, true, NULL, count(*)::int
                FROM open WHERE remote AND role_family IS NOT NULL GROUP BY role_family
    UNION ALL SELECT 'salary', NULL, NULL, NULL, true, count(*)::int FROM open WHERE has_salary
    UNION ALL SELECT 'salary_role', role_family, NULL, NULL, true, count(*)::int
                FROM open WHERE has_salary AND role_family IS NOT NULL GROUP BY role_family
  ) g
WITH DATA;

CREATE UNIQUE INDEX job_facets_k_uq   ON job_facets (k);
CREATE INDEX        job_facets_lookup ON job_facets (grain, role_family, country);
CREATE INDEX        job_facets_top    ON job_facets (grain, n DESC);
GRANT SELECT ON job_facets TO hirelane_app;
