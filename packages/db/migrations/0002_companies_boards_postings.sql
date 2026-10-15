-- 0002: companies, their ATS boards, and the raw postings read from them (public data, PLAN section 6).
CREATE TABLE companies (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL,
  name        text        NOT NULL,
  domain      text,
  logo_path   text,
  logo_source text        CHECK (logo_source IN ('favicon', 'touch_icon', 'monogram')),
  name_source text        NOT NULL DEFAULT 'config' CHECK (name_source IN ('config', 'board_meta')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_slug_uq UNIQUE (slug),
  CONSTRAINT companies_domain_uq UNIQUE (domain)
);

CREATE TABLE company_boards (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  ats                  text        NOT NULL CHECK (ats IN ('greenhouse', 'lever', 'ashby')),
  token                text        NOT NULL CHECK (token ~ '^[A-Za-z0-9._-]{1,100}$'),
  enabled              boolean     NOT NULL DEFAULT true,
  verified_at          timestamptz,
  consecutive_failures integer     NOT NULL DEFAULT 0,
  last_success_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_boards_ats_token_uq UNIQUE (ats, token)
);
CREATE INDEX company_boards_company_idx ON company_boards (company_id);

-- job_id points at the canonical jobs table created in Phase 2, so it has no foreign key yet.
CREATE TABLE postings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id      uuid        NOT NULL REFERENCES company_boards (id) ON DELETE CASCADE,
  external_id   text        NOT NULL,
  key           text        NOT NULL CHECK (char_length(key) <= 255),
  url           text        NOT NULL,
  apply_url     text,
  title         text        NOT NULL,
  location_raw  text,
  raw           jsonb       NOT NULL,
  content_hash  text        NOT NULL,
  posted_at     timestamptz,
  first_seen_at timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  missed_runs   smallint    NOT NULL DEFAULT 0 CHECK (missed_runs >= 0),
  closed_at     timestamptz,
  job_id        uuid,
  source        text        NOT NULL CHECK (source IN ('live', 'fixture')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT postings_board_external_uq UNIQUE (board_id, external_id),
  CONSTRAINT postings_key_uq UNIQUE (key)
);
CREATE INDEX postings_job_idx ON postings (job_id);
CREATE INDEX postings_open_board_idx ON postings (board_id) WHERE closed_at IS NULL;

GRANT SELECT ON companies, postings TO hirelane_app;
