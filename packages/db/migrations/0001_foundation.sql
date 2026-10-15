-- 0001_foundation: extensions, the unprivileged app role, and ops tables.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Roles are cluster-wide, so creation must tolerate a role left over from a previous database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hirelane_app') THEN
    CREATE ROLE hirelane_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO hirelane_app;

CREATE TABLE worker_heartbeats (
  worker_id text        NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX worker_heartbeats_at_idx ON worker_heartbeats (at DESC);

CREATE TABLE feature_flags (
  key     text    NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  user_id uuid
);
-- A primary key cannot hold an expression, so a unique index stands in for PK(key, coalesce(user_id, nil)).
CREATE UNIQUE INDEX feature_flags_key_user_uq
  ON feature_flags (key, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE rate_limits (
  bucket       text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- The app role reads flags and counts requests. It never touches worker or queue internals.
GRANT SELECT ON feature_flags TO hirelane_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO hirelane_app;
