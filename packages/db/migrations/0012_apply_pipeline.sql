-- 0012_apply_pipeline: right swipe = applied (owner decision 2026-10-29, docs/product/DECISIONS-2026-10-29-night.md).
--   * applications with a state machine enforced IN THE DATABASE (trigger), application_answers, receipts, apply_addresses,
--     inbound_messages, notifications and the per-ATS kill switch (platform_switches).
--   * answer_bank already exists (0010). The consent kind `auto_apply` is added to the consents CHECK below.
--   * The app role can create an application (ready only), undo it inside the window, and read. It can never write a
--     submitted, blocked or failed state, an answer, a receipt, an inbound message or a notification. The worker (owner) does.
--   * An answer row is either "needs you" (no answer) or has an answer AND at least one evidence source. The CHECK is the
--     last line of defence behind the executor's "nothing invented" rule.
--   * Sealed columns (answer_enc, evidence_enc, excerpt_enc) are vault envelopes bound to owner and row (AAD in services/src/apply/aad.ts).
--   * Daily cap lives on apply_addresses.daily_cap (counted per student, in profiles.tz, by the worker under an advisory lock).
--   * RLS follows 0007: ENABLE, never FORCE. hirelane_app owns nothing and gets explicit grants only.

-- ---------- consent kind ----------
ALTER TABLE consents DROP CONSTRAINT consents_kind;
ALTER TABLE consents ADD CONSTRAINT consents_kind CHECK (kind IN (
  'age_18_plus', 'terms', 'privacy', 'campus_share', 'offer_letter_tpo',
  'llm_resume', 'llm_contacts', 'whatsapp', 'email_picks', 'analytics', 'auto_apply'));

-- ---------- apply_addresses (one per student) ----------
-- The address is handle@domain. reply_handle is the opaque tag used for plus-addressing (handle+reply_handle@domain).
-- users.reply_handle (0008) is NOT used: this table is the single source of truth.
CREATE TABLE apply_addresses (
  user_id      uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  handle       text        NOT NULL,
  domain       text        NOT NULL,
  reply_handle text        NOT NULL,
  daily_cap    smallint    NOT NULL DEFAULT 20,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT apply_addresses_handle_fmt CHECK (handle ~ '^[a-z0-9][a-z0-9.]{1,38}[a-z0-9]$' AND handle !~ '\.\.'),
  CONSTRAINT apply_addresses_handle_reserved CHECK (handle !~ '^(admin|support|postmaster|abuse|root|noreply|no-reply|hirelane|info|hello|mail)'),
  CONSTRAINT apply_addresses_domain_fmt CHECK (domain ~ '^[a-z0-9]([a-z0-9.-]{1,98})[a-z0-9]$'),
  CONSTRAINT apply_addresses_reply_fmt CHECK (reply_handle ~ '^[a-z0-9]{8,32}$'),
  CONSTRAINT apply_addresses_cap CHECK (daily_cap BETWEEN 1 AND 200),
  CONSTRAINT apply_addresses_address_uq UNIQUE (handle, domain),
  CONSTRAINT apply_addresses_reply_uq UNIQUE (reply_handle)
);

-- ---------- platform_switches (kill switch per ATS; no user column, app role has no access) ----------
CREATE TABLE platform_switches (
  platform   text        PRIMARY KEY,
  enabled    boolean     NOT NULL DEFAULT true,
  reason     text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_switches_platform CHECK (platform IN ('greenhouse', 'lever', 'ashby')),
  CONSTRAINT platform_switches_reason_len CHECK (reason IS NULL OR char_length(reason) <= 300)
);
INSERT INTO platform_switches (platform) VALUES ('greenhouse'), ('lever'), ('ashby');
REVOKE ALL ON platform_switches FROM PUBLIC, hirelane_app;

-- ---------- applications ----------
CREATE TABLE applications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id         uuid        REFERENCES jobs (id) ON DELETE SET NULL,
  resume_id      uuid,
  status         text        NOT NULL DEFAULT 'ready',
  undo_until     timestamptz NOT NULL,
  -- Snapshot of the target, filled by the insert trigger from the job (the student cannot choose a URL).
  company_name   text        NOT NULL,
  company_domain text,
  job_title      text        NOT NULL,
  platform       text        NOT NULL,
  apply_url      text        NOT NULL,
  blocked_reason text,
  fallback_note  text,
  claimed_at     timestamptz,
  submitted_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT applications_id_user_uq UNIQUE (id, user_id),
  CONSTRAINT applications_user_job_uq UNIQUE (user_id, job_id),
  CONSTRAINT applications_resume_fk FOREIGN KEY (resume_id, user_id) REFERENCES resumes (id, user_id) ON DELETE SET NULL (resume_id),
  CONSTRAINT applications_status CHECK (status IN ('ready', 'submitting', 'submitted', 'blocked_fallback', 'failed', 'undone')),
  CONSTRAINT applications_platform CHECK (platform IN ('greenhouse', 'lever', 'ashby')),
  CONSTRAINT applications_reason_fmt CHECK (blocked_reason IS NULL OR blocked_reason ~ '^[a-z0-9_]{1,40}$'),
  CONSTRAINT applications_reason_status CHECK (blocked_reason IS NULL OR status IN ('blocked_fallback', 'failed')),
  CONSTRAINT applications_fallback_status CHECK (fallback_note IS NULL OR status = 'blocked_fallback'),
  CONSTRAINT applications_submitted_at CHECK (status <> 'submitted' OR submitted_at IS NOT NULL),
  CONSTRAINT applications_name_len CHECK (char_length(company_name) <= 200 AND char_length(job_title) <= 300),
  CONSTRAINT applications_url_len CHECK (char_length(apply_url) <= 2000)
);
CREATE INDEX applications_user_created_idx ON applications (user_id, created_at DESC);
CREATE INDEX applications_user_claimed_idx ON applications (user_id, claimed_at) WHERE claimed_at IS NOT NULL;

-- Fills the snapshot from the job. SECURITY DEFINER because company_boards is not readable by the app role; the function
-- takes no arguments and reads only NEW.job_id, so it exposes nothing else. EXECUTE is not needed to fire a trigger.
CREATE FUNCTION applications_before_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j record;
BEGIN
  SELECT c.name AS company_name, c.domain AS company_domain, jb.title, jb.closed_at, b.ats,
         coalesce(p.apply_url, p.url) AS apply_url
    INTO j
    FROM jobs jb
    JOIN companies c ON c.id = jb.company_id
    LEFT JOIN postings p ON p.id = jb.primary_posting_id
    LEFT JOIN company_boards b ON b.id = p.board_id
   WHERE jb.id = NEW.job_id;
  IF NOT FOUND OR j.ats IS NULL OR j.apply_url IS NULL THEN
    RAISE EXCEPTION 'job has no apply target' USING ERRCODE = 'check_violation', CONSTRAINT = 'applications_apply_target';
  END IF;
  IF j.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'job is closed' USING ERRCODE = 'check_violation', CONSTRAINT = 'applications_job_open';
  END IF;
  NEW.status := 'ready';
  NEW.undo_until := now() + interval '4 seconds';
  NEW.company_name := j.company_name;
  NEW.company_domain := j.company_domain;
  NEW.job_title := j.title;
  NEW.platform := j.ats;
  NEW.apply_url := j.apply_url;
  NEW.blocked_reason := NULL;
  NEW.fallback_note := NULL;
  NEW.claimed_at := NULL;
  NEW.submitted_at := NULL;
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION applications_before_insert() FROM PUBLIC, hirelane_app;
CREATE TRIGGER applications_before_insert BEFORE INSERT ON applications
  FOR EACH ROW EXECUTE FUNCTION applications_before_insert();

-- The state machine, for every role:
--   ready -> submitting          only once undo_until has passed (the worker claim)
--   ready -> undone              only before undo_until
--   undone -> ready              a fresh swipe on the same job; the window restarts
--   submitting -> submitted | blocked_fallback | failed
-- Everything else is refused. The app role may only do the two undo moves. SECURITY INVOKER on purpose: current_user is the caller.
CREATE FUNCTION applications_transition() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  from_s text := OLD.status;
  to_s   text := NEW.status;
  by_app boolean := current_user = 'hirelane_app';
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.platform <> OLD.platform OR NEW.apply_url <> OLD.apply_url THEN
    RAISE EXCEPTION 'application identity is immutable' USING ERRCODE = 'check_violation', CONSTRAINT = 'applications_immutable';
  END IF;
  NEW.updated_at := now();
  IF from_s = to_s THEN
    RETURN NEW;
  END IF;
  IF from_s = 'ready' AND to_s = 'submitting' AND NOT by_app AND now() >= OLD.undo_until THEN
    NEW.claimed_at := now();
  ELSIF from_s = 'ready' AND to_s = 'undone' AND now() < OLD.undo_until THEN
    NULL;
  ELSIF from_s = 'undone' AND to_s = 'ready' THEN
    NEW.undo_until := now() + interval '4 seconds';
  ELSIF from_s = 'submitting' AND to_s IN ('submitted', 'blocked_fallback', 'failed') AND NOT by_app THEN
    IF to_s = 'submitted' THEN
      NEW.submitted_at := now();
    END IF;
  ELSE
    RAISE EXCEPTION 'illegal application transition % -> %', from_s, to_s USING ERRCODE = 'check_violation', CONSTRAINT = 'applications_transition';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER applications_transition BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION applications_transition();

-- ---------- application_answers ----------
-- One row per form field. Written by the worker. A filled row has a sealed answer and evidence sources; a needs-you row has neither.
CREATE TABLE application_answers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid        NOT NULL,
  user_id          uuid        NOT NULL,
  field_id         text        NOT NULL,
  label            text        NOT NULL,
  question_key     text,
  required         boolean     NOT NULL DEFAULT false,
  needs_you        boolean     NOT NULL,
  reason           text,
  answer_enc       bytea,
  evidence_enc     bytea,
  -- "source:field" pairs only (for example answer_bank:notice_period). Never a value.
  evidence_sources text[]      NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_answers_app_fk FOREIGN KEY (application_id, user_id) REFERENCES applications (id, user_id) ON DELETE CASCADE,
  CONSTRAINT application_answers_field_uq UNIQUE (application_id, field_id),
  CONSTRAINT application_answers_field_len CHECK (char_length(field_id) BETWEEN 1 AND 200),
  CONSTRAINT application_answers_label_len CHECK (char_length(label) <= 300),
  CONSTRAINT application_answers_key_fmt CHECK (question_key IS NULL OR question_key ~ '^[a-z0-9_.:-]{1,80}$'),
  CONSTRAINT application_answers_reason_len CHECK (reason IS NULL OR char_length(reason) <= 300),
  CONSTRAINT application_answers_sources_len CHECK (cardinality(evidence_sources) <= 20),
  -- Nothing invented: an answer without evidence cannot be stored.
  CONSTRAINT application_answers_evidence CHECK (
    (needs_you AND answer_enc IS NULL AND evidence_enc IS NULL)
    OR (NOT needs_you AND answer_enc IS NOT NULL AND evidence_enc IS NOT NULL AND cardinality(evidence_sources) > 0))
);
CREATE INDEX application_answers_app_idx ON application_answers (application_id);

-- ---------- receipts ----------
-- What was sent: an answers hash, the resume version, the time, the platform and the result code. One per application.
CREATE TABLE receipts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid        NOT NULL,
  user_id        uuid        NOT NULL,
  answers_hash   text        NOT NULL,
  resume_id      uuid,
  resume_version smallint,
  platform       text        NOT NULL,
  result_code    text        NOT NULL,
  -- false when the attempt stopped before any request carrying the answers left the process.
  sent           boolean     NOT NULL,
  http_status    smallint,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipts_app_fk FOREIGN KEY (application_id, user_id) REFERENCES applications (id, user_id) ON DELETE CASCADE,
  CONSTRAINT receipts_app_uq UNIQUE (application_id),
  CONSTRAINT receipts_hash_fmt CHECK (answers_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT receipts_platform CHECK (platform IN ('greenhouse', 'lever', 'ashby')),
  CONSTRAINT receipts_result_fmt CHECK (result_code ~ '^[a-z0-9_:.-]{1,48}$'),
  CONSTRAINT receipts_http_range CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599)
);

-- ---------- inbound_messages ----------
-- Parsed employer mail. The subject and excerpt are sealed together; kind and employer are the parsed result.
CREATE TABLE inbound_messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  application_id uuid,
  message_id     text        NOT NULL,
  employer       text        NOT NULL,
  from_domain    text        NOT NULL,
  kind           text        NOT NULL,
  matched_by     text        NOT NULL,
  excerpt_enc    bytea       NOT NULL,
  received_at    timestamptz NOT NULL,
  forwarded_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_app_fk FOREIGN KEY (application_id, user_id) REFERENCES applications (id, user_id) ON DELETE SET NULL (application_id),
  CONSTRAINT inbound_user_message_uq UNIQUE (user_id, message_id),
  CONSTRAINT inbound_kind CHECK (kind IN ('interview', 'test', 'rejection', 'other')),
  CONSTRAINT inbound_matched_by CHECK (matched_by IN ('company', 'domain', 'none')),
  CONSTRAINT inbound_employer_len CHECK (char_length(employer) <= 200),
  CONSTRAINT inbound_domain_len CHECK (char_length(from_domain) <= 255),
  CONSTRAINT inbound_message_id_len CHECK (char_length(message_id) BETWEEN 1 AND 500)
);
CREATE INDEX inbound_user_received_idx ON inbound_messages (user_id, received_at DESC);
CREATE INDEX inbound_app_idx ON inbound_messages (application_id) WHERE application_id IS NOT NULL;

-- ---------- notifications (in-app) ----------
CREATE TABLE notifications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind           text        NOT NULL,
  title          text        NOT NULL,
  application_id uuid,
  inbound_id     uuid        REFERENCES inbound_messages (id) ON DELETE SET NULL,
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_app_fk FOREIGN KEY (application_id, user_id) REFERENCES applications (id, user_id) ON DELETE SET NULL (application_id),
  CONSTRAINT notifications_kind CHECK (kind IN ('employer_message', 'application_update')),
  CONSTRAINT notifications_title_len CHECK (char_length(title) BETWEEN 1 AND 200)
);
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);

-- ---------- Row level security (ENABLE, not FORCE) ----------
ALTER TABLE apply_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY apply_addresses_own ON apply_addresses FOR ALL TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON apply_addresses FROM hirelane_app;
GRANT SELECT ON apply_addresses TO hirelane_app;
GRANT INSERT (user_id, handle, domain, reply_handle) ON apply_addresses TO hirelane_app;

-- applications: insert (the trigger forces status ready and the snapshot) and the undo moves. No delete.
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY applications_own ON applications FOR ALL TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON applications FROM hirelane_app;
GRANT SELECT ON applications TO hirelane_app;
GRANT INSERT (id, user_id, job_id, resume_id) ON applications TO hirelane_app;
GRANT UPDATE (status) ON applications TO hirelane_app;

ALTER TABLE application_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY application_answers_own_sel ON application_answers FOR SELECT TO hirelane_app USING (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON application_answers FROM hirelane_app;
GRANT SELECT ON application_answers TO hirelane_app;

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY receipts_own_sel ON receipts FOR SELECT TO hirelane_app USING (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON receipts FROM hirelane_app;
GRANT SELECT ON receipts TO hirelane_app;

ALTER TABLE inbound_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY inbound_messages_own_sel ON inbound_messages FOR SELECT TO hirelane_app USING (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON inbound_messages FROM hirelane_app;
GRANT SELECT ON inbound_messages TO hirelane_app;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON notifications FOR ALL TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON notifications FROM hirelane_app;
GRANT SELECT ON notifications TO hirelane_app;
GRANT UPDATE (read_at) ON notifications TO hirelane_app;
