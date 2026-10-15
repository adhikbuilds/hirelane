// Seed copied from tests/jobs-query.test.ts so the API tests do not depend on another file's internals.
export const SEED = `
INSERT INTO companies (slug, name)
SELECT 'co-' || g, (ARRAY['Acme Labs','Borealis','Cinder_Works','Delta 100%','Ember','Fjord'])[g + 1] FROM generate_series(0, 5) g;
INSERT INTO company_boards (company_id, ats, token)
SELECT id, (ARRAY['greenhouse','lever','ashby'])[(right(slug, 1)::int % 3) + 1], slug FROM companies;
INSERT INTO postings (board_id, external_id, key, url, title, raw, content_hash, first_seen_at, last_seen_at, source)
SELECT id, 'p', 'k:' || id, 'https://x.test/p', 't', '{}', 'h', '2026-01-01', '2026-01-01', 'fixture' FROM company_boards;
INSERT INTO skills (id, label, category) VALUES ('python','Python','language'), ('sql','SQL','language'), ('rust','Rust','language');
`;

export const SEED_JOBS = `
INSERT INTO jobs (slug, company_id, title, title_norm, role_family, level, workplace, employment, remote, remote_scope,
                  countries, locations, visa, doc_hash, salary_min_minor, salary_max_minor, salary_currency, salary_period,
                  salary_annual_usd_min, salary_annual_usd_max, salary_annual_inr_min, salary_annual_inr_max,
                  salary_source, salary_kind, salary_trace, fx_date, salary_stated, skills,
                  posted_at, first_seen_at, last_seen_at, closed_at, enrich_version, primary_posting_id, source)
SELECT 'job-' || i, c.id,
       (ARRAY['Data Engineer','Backend Engineer','Product Manager','Staff Designer','ML Scientist','Platform Engineer'])[(i % 6) + 1] || ' ' || i,
       'x',
       CASE WHEN i % 11 = 0 THEN NULL ELSE (ARRAY['data-engineer','software-engineer-general','product-manager','designer','data-scientist','devops-engineer'])[(i % 6) + 1] END,
       (ARRAY[NULL,'intern','entry','mid','senior','lead','executive'])[(i % 7) + 1],
       (ARRAY['remote','hybrid','onsite',NULL])[(i % 4) + 1],
       (ARRAY['fulltime','contract','parttime','intern',NULL])[(i % 5) + 1],
       (i % 4) = 0,
       CASE WHEN (i % 4) = 0 AND i % 3 = 0 THEN 'worldwide' WHEN (i % 4) = 0 THEN 'countries' ELSE 'none' END,
       (ARRAY['{}','{IN}','{US}','{IN,US}','{GB,DE}'])[(i % 5) + 1]::char(2)[],
       CASE WHEN i % 2 = 0 THEN jsonb_build_object('all', jsonb_build_array('Bengaluru, India')) ELSE '[]'::jsonb END,
       CASE WHEN i % 6 = 0 THEN 'yes' WHEN i % 6 = 1 THEN 'no' ELSE 'unknown' END,
       'h',
       CASE WHEN i % 3 = 0 THEN CASE WHEN i % 9 = 0 THEN NULL ELSE 8000000 + i * 100000 END END,
       CASE WHEN i % 3 = 0 THEN 9000000 + i * 100000 END,
       CASE WHEN i % 3 = 0 THEN 'USD' END, CASE WHEN i % 3 = 0 THEN 'year' END,
       CASE WHEN i % 3 = 0 AND i % 9 <> 0 THEN 8000000 + i * 100000 END,
       CASE WHEN i % 3 = 0 THEN 9000000 + i * 100000 END,
       CASE WHEN i % 3 = 0 AND i % 9 <> 0 THEN (8000000 + i * 100000)::bigint * 88 END,
       CASE WHEN i % 3 = 0 THEN (9000000 + i * 100000)::bigint * 88 END,
       CASE WHEN i % 3 = 0 THEN 'text' END, CASE WHEN i % 3 = 0 THEN 'base' END,
       CASE WHEN i % 3 = 0 THEN '[]'::jsonb END, CASE WHEN i % 3 = 0 THEN DATE '2026-10-01' END,
       i % 3 = 0,
       CASE WHEN i % 2 = 0 THEN ARRAY['python','sql'] WHEN i % 3 = 0 THEN ARRAY['rust'] ELSE '{}' END,
       CASE WHEN i % 4 <> 0 THEN TIMESTAMPTZ '2026-10-15' - make_interval(hours => i) END,
       TIMESTAMPTZ '2026-10-15' - make_interval(hours => i) - interval '1 hour',
       TIMESTAMPTZ '2026-10-15', CASE WHEN i % 13 = 0 THEN TIMESTAMPTZ '2026-10-14' END,
       1, pc.posting_id, CASE WHEN i % 10 = 0 THEN 'fixture' ELSE 'live' END
  FROM generate_series(1, 240) i
  JOIN (SELECT id, row_number() OVER (ORDER BY slug) - 1 AS n FROM companies) c ON c.n = i % 6
  JOIN (SELECT b.company_id, p.id AS posting_id FROM company_boards b JOIN postings p ON p.board_id = b.id) pc ON pc.company_id = c.id;
UPDATE jobs SET search_text = job_search_text(title, company_id, skills);
REFRESH MATERIALIZED VIEW job_facets;
`;
