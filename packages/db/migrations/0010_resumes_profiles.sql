-- 0010_resumes_profiles: profiles, work authorisation, answer bank, resumes, file access log, eligibility profile.
-- Amendment B sections 7, 13 and 14.
--   * profiles is trimmed: college_tier, cohort_code (campus tables own them), grad_year and degree (eligibility_profiles owns them).
--   * resumes has no dek_wrapped: the vault envelope is self-contained in the sealed blob. The original file name lives only
--     inside parsed_enc, so there is no file name column anywhere.
--   * health stores check ids, statuses and offsets only. Findings store kind and offsets, never a value.
--   * RLS follows 0007: ENABLE, never FORCE. hirelane_app owns nothing and gets explicit grants only.
--   * Row removal is by the owner role (purge job, account delete cascade). The app role soft-deletes resumes.
--   * Account delete cascades these rows away, so the blob_key of each resume must be purged BEFORE the users row goes.

-- LinkedIn sign-in lane: no migration of its own.
ALTER TABLE auth_identities DROP CONSTRAINT auth_identities_provider;
ALTER TABLE auth_identities ADD CONSTRAINT auth_identities_provider
  CHECK (provider IN ('google', 'email_otp', 'phone_otp', 'linkedin'));

-- ---------- profiles ----------
CREATE TABLE profiles (
  user_id          uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  college_text_enc bytea,
  role_families    text[]      NOT NULL DEFAULT '{}',
  cities           text[]      NOT NULL DEFAULT '{}',
  remote_ok        boolean     NOT NULL DEFAULT false,
  level            text,
  floor_minor      bigint,
  floor_currency   text,
  tz               text        NOT NULL DEFAULT 'Asia/Kolkata',
  picks_hour       smallint    NOT NULL DEFAULT 9,
  paused_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_role_families_len CHECK (cardinality(role_families) <= 10),
  CONSTRAINT profiles_cities_len CHECK (cardinality(cities) <= 20),
  CONSTRAINT profiles_level_fmt CHECK (level IS NULL OR level ~ '^[a-z_]{1,24}$'),
  CONSTRAINT profiles_floor_nonneg CHECK (floor_minor IS NULL OR floor_minor >= 0),
  CONSTRAINT profiles_floor_currency_fmt CHECK (floor_currency IS NULL OR floor_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT profiles_tz_len CHECK (char_length(tz) BETWEEN 1 AND 64),
  CONSTRAINT profiles_picks_hour CHECK (picks_hour BETWEEN 0 AND 23)
);

-- ---------- work_authorizations ----------
CREATE TABLE work_authorizations (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  country    text        NOT NULL,
  status     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, country),
  CONSTRAINT work_authorizations_country_fmt CHECK (country ~ '^[A-Z]{2}$'),
  CONSTRAINT work_authorizations_status CHECK (status IN ('citizen', 'permanent', 'visa_held', 'needs_sponsorship'))
);

-- ---------- answer_bank ----------
CREATE TABLE answer_bank (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question_key text        NOT NULL,
  label_seen   text,
  answer_enc   bytea       NOT NULL,
  sensitive    boolean     NOT NULL DEFAULT false,
  source       text        NOT NULL DEFAULT 'user',
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT answer_bank_key_fmt CHECK (question_key ~ '^[a-z0-9_.:-]{1,80}$'),
  CONSTRAINT answer_bank_label_len CHECK (label_seen IS NULL OR char_length(label_seen) <= 300),
  CONSTRAINT answer_bank_source CHECK (source IN ('user', 'resume')),
  CONSTRAINT answer_bank_user_key_uq UNIQUE (user_id, question_key)
);

-- ---------- resumes ----------
-- parent_id NULL is a root (an upload or a builder resume). Confirming a parse creates a version row with a parent.
-- The cap of 3 counts active roots only.
CREATE TABLE resumes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  parent_id        uuid,
  label            text,
  source           text        NOT NULL,
  mime             text        NOT NULL,
  size_bytes       integer     NOT NULL,
  file_hmac        text        NOT NULL,
  blob_key         text        NOT NULL,
  pages            smallint,
  text_layer       text,
  producer_family  text,
  parse_status     text        NOT NULL DEFAULT 'uploaded',
  reject_code      text,
  parsed_enc       bytea,
  parsed_version   smallint    NOT NULL DEFAULT 0,
  health           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  health_passed    smallint    NOT NULL DEFAULT 0,
  health_total     smallint    NOT NULL DEFAULT 0,
  sensitive_kinds  text[]      NOT NULL DEFAULT '{}',
  skills           text[]      NOT NULL DEFAULT '{}',
  confirmed_at     timestamptz,
  is_default       boolean     NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  purge_after      timestamptz,
  purged_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resumes_id_user_uq UNIQUE (id, user_id),
  -- A version must belong to the same user as its root.
  CONSTRAINT resumes_parent_fk FOREIGN KEY (parent_id, user_id) REFERENCES resumes (id, user_id) ON DELETE CASCADE,
  CONSTRAINT resumes_label_len CHECK (label IS NULL OR char_length(label) <= 80),
  CONSTRAINT resumes_source CHECK (source IN ('upload', 'builder')),
  CONSTRAINT resumes_mime CHECK (mime IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  CONSTRAINT resumes_size CHECK (size_bytes BETWEEN 1 AND 5242880),
  CONSTRAINT resumes_pages CHECK (pages IS NULL OR pages BETWEEN 1 AND 100),
  CONSTRAINT resumes_text_layer CHECK (text_layer IS NULL OR text_layer IN ('readable', 'partial', 'none', 'garbled')),
  CONSTRAINT resumes_producer_fmt CHECK (producer_family IS NULL OR producer_family ~ '^[a-z_]{1,24}$'),
  CONSTRAINT resumes_parse_status CHECK (parse_status IN ('uploaded', 'extracting', 'parsed', 'needs_text', 'rejected', 'failed', 'confirmed', 'draft')),
  CONSTRAINT resumes_reject_code_fmt CHECK (reject_code IS NULL OR reject_code ~ '^[a-z_]{1,32}$'),
  CONSTRAINT resumes_reject_code_status CHECK (reject_code IS NULL OR parse_status IN ('rejected', 'failed')),
  CONSTRAINT resumes_health_array CHECK (jsonb_typeof(health) = 'array'),
  CONSTRAINT resumes_health_counts CHECK (health_total BETWEEN 0 AND 9 AND health_passed BETWEEN 0 AND health_total),
  CONSTRAINT resumes_sensitive_kinds CHECK (sensitive_kinds <@ ARRAY['aadhaar', 'aadhaar_masked', 'vid', 'pan', 'dob', 'parent_name', 'religion', 'caste', 'marital_status', 'image']::text[]),
  CONSTRAINT resumes_skills_len CHECK (cardinality(skills) <= 200),
  CONSTRAINT resumes_confirmed CHECK (parse_status <> 'confirmed' OR confirmed_at IS NOT NULL),
  CONSTRAINT resumes_deleted_purge CHECK (deleted_at IS NULL OR purge_after IS NOT NULL),
  CONSTRAINT resumes_purged_clean CHECK (purged_at IS NULL OR parsed_enc IS NULL)
);
CREATE INDEX resumes_user_created_idx ON resumes (user_id, created_at DESC);
CREATE UNIQUE INDEX resumes_one_default_uq ON resumes (user_id) WHERE is_default AND deleted_at IS NULL;
CREATE UNIQUE INDEX resumes_root_file_uq ON resumes (user_id, file_hmac) WHERE parent_id IS NULL AND deleted_at IS NULL;
CREATE INDEX resumes_purge_idx ON resumes (purge_after) WHERE purge_after IS NOT NULL AND purged_at IS NULL;

-- At most 3 active roots per user. Serialised per user with an advisory lock so concurrent uploads cannot both pass.
-- SECURITY INVOKER on purpose: under RLS the caller counts only their own rows, which is exactly the set that matters.
CREATE FUNCTION resumes_cap_active_roots() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NULL AND NEW.deleted_at IS NULL
     AND NOT (TG_OP = 'UPDATE' AND OLD.parent_id IS NULL AND OLD.deleted_at IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('resumes_roots:' || NEW.user_id::text, 0));
    IF (SELECT count(*) FROM resumes
         WHERE user_id = NEW.user_id AND parent_id IS NULL AND deleted_at IS NULL AND id <> NEW.id) >= 3 THEN
      RAISE EXCEPTION 'at most 3 active resumes per user' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER resumes_cap_active_roots BEFORE INSERT OR UPDATE OF deleted_at, parent_id ON resumes
  FOR EACH ROW EXECUTE FUNCTION resumes_cap_active_roots();

-- ---------- file_access_log (insert-only audit) ----------
CREATE TABLE file_access_log (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  resume_id uuid,
  action    text        NOT NULL,
  ip_hash   text,
  at        timestamptz NOT NULL DEFAULT now(),
  -- Same-user resume only. The row outlives the resume (resume_id goes NULL) so the audit trail stays.
  CONSTRAINT file_access_log_resume_fk FOREIGN KEY (resume_id, user_id) REFERENCES resumes (id, user_id) ON DELETE SET NULL (resume_id),
  CONSTRAINT file_access_log_action CHECK (action IN ('download', 'preview', 'purge'))
);
CREATE INDEX file_access_log_user_at_idx ON file_access_log (user_id, at DESC);

-- ---------- eligibility_profiles (Amendment B section 7) ----------
-- Plain columns on purpose: matching and k >= 10 SQL aggregates need them. Written only on confirm.
CREATE TABLE eligibility_profiles (
  user_id          uuid         PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  pct_10           numeric(5,2),
  board_10         text,
  secondary_kind   text,
  pct_secondary    numeric(5,2),
  board_secondary  text,
  degree           text,
  branch_code      text,
  branch_raw       text,
  grad_score       numeric(5,2),
  grad_scale       smallint,
  grad_pct_equiv   numeric(5,2),
  grad_conversion  text,
  grad_is_final    boolean,
  active_backlogs  smallint,
  backlog_history  smallint,
  gap_years        smallint,
  passout_year     smallint,
  lateral_entry    boolean,
  field_meta       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  source_resume_id uuid,
  confirmed_at     timestamptz  NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT eligibility_source_resume_fk FOREIGN KEY (source_resume_id, user_id) REFERENCES resumes (id, user_id) ON DELETE SET NULL (source_resume_id),
  CONSTRAINT eligibility_pct_10 CHECK (pct_10 IS NULL OR pct_10 BETWEEN 0 AND 100),
  CONSTRAINT eligibility_pct_secondary CHECK (pct_secondary IS NULL OR pct_secondary BETWEEN 0 AND 100),
  CONSTRAINT eligibility_board_10_len CHECK (board_10 IS NULL OR char_length(board_10) <= 80),
  CONSTRAINT eligibility_board_secondary_len CHECK (board_secondary IS NULL OR char_length(board_secondary) <= 80),
  CONSTRAINT eligibility_secondary_kind CHECK (secondary_kind IS NULL OR secondary_kind IN ('12th', 'diploma')),
  CONSTRAINT eligibility_degree_len CHECK (degree IS NULL OR char_length(degree) <= 80),
  CONSTRAINT eligibility_branch_code_fmt CHECK (branch_code IS NULL OR branch_code ~ '^[A-Za-z0-9_]{1,24}$'),
  CONSTRAINT eligibility_branch_raw_len CHECK (branch_raw IS NULL OR char_length(branch_raw) <= 120),
  CONSTRAINT eligibility_grad_scale CHECK (grad_scale IS NULL OR grad_scale IN (4, 5, 10, 100)),
  CONSTRAINT eligibility_grad_score CHECK (grad_score IS NULL OR (grad_score >= 0 AND (grad_scale IS NULL OR grad_score <= grad_scale))),
  CONSTRAINT eligibility_grad_pct_equiv CHECK (grad_pct_equiv IS NULL OR grad_pct_equiv BETWEEN 0 AND 100),
  CONSTRAINT eligibility_grad_conversion CHECK (grad_conversion IS NULL OR grad_conversion IN ('direct', 'unknown')
    OR grad_conversion ~ '^campus:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT eligibility_active_backlogs CHECK (active_backlogs IS NULL OR active_backlogs BETWEEN 0 AND 50),
  CONSTRAINT eligibility_backlog_history CHECK (backlog_history IS NULL OR backlog_history BETWEEN 0 AND 100),
  CONSTRAINT eligibility_gap_years CHECK (gap_years IS NULL OR gap_years BETWEEN 0 AND 20),
  CONSTRAINT eligibility_passout_year CHECK (passout_year IS NULL OR passout_year BETWEEN 1990 AND 2100),
  CONSTRAINT eligibility_field_meta_object CHECK (jsonb_typeof(field_meta) = 'object')
);
CREATE INDEX eligibility_branch_year_idx ON eligibility_profiles (branch_code, passout_year);

-- ---------- Row level security (ENABLE, not FORCE) ----------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_own ON profiles FOR ALL TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON profiles FROM hirelane_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO hirelane_app;

ALTER TABLE work_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_authorizations_own ON work_authorizations FOR ALL TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON work_authorizations FROM hirelane_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON work_authorizations TO hirelane_app;

ALTER TABLE answer_bank ENABLE ROW LEVEL SECURITY;
CREATE POLICY answer_bank_own ON answer_bank FOR ALL TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON answer_bank FROM hirelane_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON answer_bank TO hirelane_app;

ALTER TABLE eligibility_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY eligibility_profiles_own ON eligibility_profiles FOR ALL TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON eligibility_profiles FROM hirelane_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON eligibility_profiles TO hirelane_app;

-- resumes: the app role reads, inserts and soft-deletes its own rows. It cannot hard-delete (the owner role purges, so a
-- blob is never orphaned) and cannot edit extractor-owned columns (pages, text_layer, producer_family, reject_code,
-- health*, sensitive_kinds, purged_at, file and blob identity). The worker writes those as the owner role.
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
CREATE POLICY resumes_own ON resumes FOR ALL TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON resumes FROM hirelane_app;
GRANT SELECT ON resumes TO hirelane_app;
GRANT INSERT (id, user_id, parent_id, label, source, mime, size_bytes, file_hmac, blob_key, pages, text_layer, producer_family,
              parse_status, parsed_enc, parsed_version, health, health_passed, health_total, sensitive_kinds, skills,
              confirmed_at, is_default)
  ON resumes TO hirelane_app;
GRANT UPDATE (label, parse_status, parsed_enc, parsed_version, skills, confirmed_at, is_default, deleted_at, purge_after, updated_at)
  ON resumes TO hirelane_app;

-- file_access_log: insert-only audit, in the same transaction as the download.
ALTER TABLE file_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY file_access_log_own_sel ON file_access_log FOR SELECT TO hirelane_app USING (user_id = current_setting('hirelane.user_id')::uuid);
CREATE POLICY file_access_log_own_ins ON file_access_log FOR INSERT TO hirelane_app WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON file_access_log FROM hirelane_app;
GRANT SELECT, INSERT ON file_access_log TO hirelane_app;
