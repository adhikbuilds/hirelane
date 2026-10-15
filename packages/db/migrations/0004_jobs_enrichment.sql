-- 0004: canonical jobs and everything the enrichment engine derives (PLAN section 6, Phase 2.8).
-- Money is bigint minor units plus char(3) currency. Every derived value carries a Trace (jsonb).

CREATE TABLE skills (
  id         text        PRIMARY KEY,
  label      text        NOT NULL,
  aliases    text[]      NOT NULL DEFAULT '{}',
  category   text        NOT NULL CHECK (category IN ('language', 'framework', 'database', 'cloud', 'tool', 'practice', 'domain', 'soft')),
  adjacent   text[]      NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX skills_aliases_gin ON skills USING gin (aliases);

CREATE TABLE fx_rates (
  as_of      date          NOT NULL,
  currency   char(3)       NOT NULL,
  per_usd    numeric(18,8) NOT NULL CHECK (per_usd > 0),
  source     text          NOT NULL,
  created_at timestamptz   NOT NULL DEFAULT now(),
  updated_at timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (as_of, currency)
);

CREATE TABLE jobs (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text          NOT NULL,
  company_id            uuid          NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  title                 text          NOT NULL,
  title_norm            text          NOT NULL,
  role_family           text,
  level                 text          CHECK (level IN ('intern', 'entry', 'mid', 'senior', 'lead', 'executive')),
  workplace             text          CHECK (workplace IN ('remote', 'hybrid', 'onsite')),
  employment            text          CHECK (employment IN ('fulltime', 'parttime', 'contract', 'intern')),
  remote                boolean       NOT NULL DEFAULT false,
  remote_scope          text          NOT NULL DEFAULT 'none' CHECK (remote_scope IN ('none', 'countries', 'region', 'worldwide')),
  countries             char(2)[]     NOT NULL DEFAULT '{}',
  locations             jsonb         NOT NULL DEFAULT '[]',
  visa                  text          NOT NULL DEFAULT 'unknown' CHECK (visa IN ('yes', 'no', 'unknown')),
  -- description_text is Doc.text: the frame for every stored span and trace offset. description_md is display only.
  description_md        text,
  description_text      text,
  doc_hash              text          NOT NULL,
  salary_min_minor      bigint        CHECK (salary_min_minor >= 0),
  salary_max_minor      bigint        CHECK (salary_max_minor >= 0),
  salary_currency       char(3),
  salary_period         text          CHECK (salary_period IN ('hour', 'day', 'week', 'month', 'year')),
  salary_annual_usd_min bigint        CHECK (salary_annual_usd_min >= 0),
  salary_annual_usd_max bigint        CHECK (salary_annual_usd_max >= 0),
  salary_annual_inr_min bigint        CHECK (salary_annual_inr_min >= 0),
  salary_annual_inr_max bigint        CHECK (salary_annual_inr_max >= 0),
  salary_source         text          CHECK (salary_source IN ('ats_structured', 'text', 'llm')),
  salary_kind           text          CHECK (salary_kind IN ('base', 'ote')),
  salary_ctc            boolean,
  salary_trace          jsonb,
  fx_date               date,
  -- True when pay is stated anywhere (structured comp or a salary cue in the text), parsed or not: the coverage ceiling.
  salary_stated         boolean       NOT NULL DEFAULT false,
  skills                text[]        NOT NULL DEFAULT '{}',
  simhash               bigint,
  token_count           integer       NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  embedding             vector(384),
  embedding_model       text,
  -- One Trace per derived field (title, workplace, countries, skills, requirements, level, employment, role_family, visa).
  traces                jsonb         NOT NULL DEFAULT '{}',
  llm_eligibility       jsonb,
  posted_at             timestamptz,
  first_seen_at         timestamptz   NOT NULL,
  last_seen_at          timestamptz   NOT NULL,
  closed_at             timestamptz,
  enrich_version        integer       NOT NULL,
  primary_posting_id    uuid          REFERENCES postings (id) ON DELETE SET NULL,
  source                text          NOT NULL CHECK (source IN ('live', 'fixture')),
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT jobs_slug_uq UNIQUE (slug),
  -- A salary is never stored without the steps that explain it.
  CONSTRAINT jobs_salary_has_trace CHECK (
    (salary_min_minor IS NULL AND salary_max_minor IS NULL)
    OR (salary_trace IS NOT NULL AND salary_currency IS NOT NULL AND salary_period IS NOT NULL AND salary_source IS NOT NULL)
  )
);
CREATE INDEX jobs_fresh_idx ON jobs ((coalesce(posted_at, first_seen_at)) DESC) WHERE closed_at IS NULL;
CREATE INDEX jobs_skills_gin ON jobs USING gin (skills);
CREATE INDEX jobs_countries_gin ON jobs USING gin (countries);
CREATE INDEX jobs_title_norm_trgm ON jobs USING gin (title_norm gin_trgm_ops);
CREATE INDEX jobs_salary_usd_idx ON jobs (salary_annual_usd_min) WHERE salary_annual_usd_min IS NOT NULL AND closed_at IS NULL;
CREATE INDEX jobs_role_level_idx ON jobs (role_family, level) WHERE closed_at IS NULL;
CREATE INDEX jobs_company_closed_idx ON jobs (company_id, closed_at);
CREATE INDEX jobs_cluster_idx ON jobs (company_id, title_norm) WHERE closed_at IS NULL;
CREATE INDEX jobs_embedding_hnsw ON jobs USING hnsw (embedding vector_cosine_ops);

CREATE TABLE job_requirements (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid        NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  ord        integer     NOT NULL,
  kind       text        NOT NULL CHECK (kind IN ('must', 'nice')),
  text       text        NOT NULL,
  category   text        NOT NULL CHECK (category IN ('skill', 'experience', 'education', 'language', 'location', 'authorization', 'other')),
  skill_ids  text[]      NOT NULL DEFAULT '{}',
  years_min  integer     CHECK (years_min >= 0),
  span_start integer     NOT NULL,
  span_end   integer     NOT NULL,
  section    text,
  extractor  text        NOT NULL CHECK (extractor IN ('rule', 'llm')),
  confidence real        NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  rule_ids   text[]      NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_requirements_job_ord_uq UNIQUE (job_id, ord),
  CONSTRAINT job_requirements_span_ok CHECK (span_start >= 0 AND span_end > span_start)
);

-- postings.job_id was a bare uuid until jobs existed. enriched_* record what each posting was last enriched from,
-- so a changed posting or a bumped enrich_version selects it again and nothing else.
ALTER TABLE postings ADD CONSTRAINT postings_job_fk FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE SET NULL;
ALTER TABLE postings ADD COLUMN enriched_content_hash text;
ALTER TABLE postings ADD COLUMN enriched_version integer;

GRANT SELECT ON jobs, job_requirements, skills TO hirelane_app;
