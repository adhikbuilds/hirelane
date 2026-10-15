-- 0003: one row per ingest run, and one row per board per run (counts are never null).
CREATE TABLE ingest_runs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger          text        NOT NULL CHECK (trigger IN ('cron', 'manual', 'fixture')),
  mode             text        NOT NULL CHECK (mode IN ('live', 'fixture')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  status           text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  boards_ok        integer     NOT NULL DEFAULT 0,
  boards_failed    integer     NOT NULL DEFAULT 0,
  postings_new     integer     NOT NULL DEFAULT 0,
  postings_changed integer     NOT NULL DEFAULT 0,
  postings_closed  integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingest_runs_started_idx ON ingest_runs (started_at DESC);

-- 'running' only exists inside the ingest transaction. 'empty_suspect' is a 2xx with no listings
-- for a board that has open postings; it counts as a failed fetch for soft-close purposes.
CREATE TABLE ingest_source_runs (
  run_id      uuid        NOT NULL REFERENCES ingest_runs (id) ON DELETE CASCADE,
  board_id    uuid        NOT NULL REFERENCES company_boards (id) ON DELETE CASCADE,
  status      text        NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'empty_suspect')),
  http_status integer,
  fetched     integer     NOT NULL DEFAULT 0,
  new         integer     NOT NULL DEFAULT 0,
  changed     integer     NOT NULL DEFAULT 0,
  unchanged   integer     NOT NULL DEFAULT 0,
  closed      integer     NOT NULL DEFAULT 0,
  bytes       bigint      NOT NULL DEFAULT 0,
  duration_ms integer     NOT NULL DEFAULT 0,
  error_text  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, board_id)
);
CREATE INDEX ingest_source_runs_board_idx ON ingest_source_runs (board_id, run_id DESC);
