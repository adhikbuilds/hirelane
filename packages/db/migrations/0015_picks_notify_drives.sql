-- 0015_picks_notify_drives: P0-2 picks (no new table: picks are computed per request from open jobs), P0-5 drive inbox
-- (deadline, rounds, documents, draft/live/closed, scam flags staff-only) and P0-6 notifications that land.
--
-- Drive lifecycle. The stored `status` stays published | closed (the nightly job, the RLS policy and every earlier test read
-- it). A drive is a DRAFT while it is published but `announced_at` is NULL: students cannot see it, yet the nightly job still
-- evaluates it, so the TPO can read the reach (qualify + could not check, k >= 10) before announcing. LIVE is announced and
-- not closed; CLOSED is status closed or a deadline that has passed. Plain inserts keep announcing at once (DEFAULT now()).

-- ---------- drives ----------
ALTER TABLE drives ADD COLUMN deadline     date;
ALTER TABLE drives ADD COLUMN rounds       text;
ALTER TABLE drives ADD COLUMN documents    text;
ALTER TABLE drives ADD COLUMN announced_at timestamptz DEFAULT now();
UPDATE drives SET announced_at = published_at;
ALTER TABLE drives ADD CONSTRAINT drives_rounds_len CHECK (rounds IS NULL OR char_length(rounds) <= 2000);
ALTER TABLE drives ADD CONSTRAINT drives_documents_len CHECK (documents IS NULL OR char_length(documents) <= 2000);

-- A student sees an announced, published drive of their own cohort. Drafts stay with the staff.
DROP POLICY drives_cohort_sel ON drives;
CREATE POLICY drives_cohort_sel ON drives FOR SELECT TO hirelane_app
  USING (status = 'published' AND announced_at IS NOT NULL
     AND cohort_id IN (SELECT m.cohort_id FROM cohort_members m WHERE m.user_id = current_setting('hirelane.user_id')::uuid));

-- Scam flags are for staff. A student's session can no longer read them even by naming the column.
REVOKE SELECT ON drives FROM hirelane_app;
GRANT SELECT (id, campus_id, cohort_id, title, link, notice_text, criteria, status, published_at, deadline, rounds, documents, announced_at)
  ON drives TO hirelane_app;

-- create (draft or announced). Needs a write role (owner or officer, 0014 tpo_can_write). Same 10 per cohort per 30 days cap as
-- tpo_publish_drive, drafts included.
CREATE FUNCTION tpo_create_drive(
  p_cohort_id uuid, p_title text, p_link text, p_notice text, p_criteria jsonb, p_flags jsonb, p_risk text,
  p_deadline date, p_rounds text, p_documents text, p_announce boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campus uuid := tpo_campus_of_cohort(p_cohort_id);
  v_id     uuid;
BEGIN
  IF v_campus IS NULL THEN RETURN NULL; END IF;
  IF NOT tpo_can_write(v_campus) THEN
    RAISE EXCEPTION 'tpo_write_role_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT count(*) FROM drives d WHERE d.cohort_id = p_cohort_id AND d.published_at > now() - interval '30 days') >= 10 THEN
    RAISE EXCEPTION 'drive limit reached for this cohort' USING ERRCODE = 'check_violation', CONSTRAINT = 'drives_per_cohort_limit';
  END IF;
  INSERT INTO drives (campus_id, cohort_id, title, link, notice_text, criteria, scam_flags, scam_risk, deadline, rounds, documents, announced_at, created_by)
  VALUES (v_campus, p_cohort_id, p_title, p_link, p_notice, p_criteria, p_flags, p_risk, p_deadline, p_rounds, p_documents,
          CASE WHEN p_announce THEN now() ELSE NULL END, current_setting('hirelane.user_id')::uuid)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- draft -> live. False when the drive is not a draft of a campus the caller staffs (the service answers 404).
CREATE FUNCTION tpo_announce_drive(p_drive_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campus uuid;
BEGIN
  SELECT d.campus_id INTO v_campus FROM drives d WHERE d.id = p_drive_id;
  IF v_campus IS NULL OR tpo_role(v_campus) IS NULL THEN RETURN NULL; END IF;
  IF NOT tpo_can_write(v_campus) THEN
    RAISE EXCEPTION 'tpo_write_role_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE drives SET announced_at = now() WHERE id = p_drive_id AND status = 'published' AND announced_at IS NULL;
  RETURN FOUND;
END
$$;

-- live or draft -> closed. Closing is final; students stop seeing the drive.
CREATE FUNCTION tpo_close_drive(p_drive_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campus uuid;
BEGIN
  SELECT d.campus_id INTO v_campus FROM drives d WHERE d.id = p_drive_id;
  IF v_campus IS NULL OR tpo_role(v_campus) IS NULL THEN RETURN NULL; END IF;
  IF NOT tpo_can_write(v_campus) THEN
    RAISE EXCEPTION 'tpo_write_role_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE drives SET status = 'closed' WHERE id = p_drive_id AND status = 'published';
  RETURN FOUND;
END
$$;

-- The staff list: derived status (draft | live | closed), the deadline and the free-text rounds and documents. Scam flags
-- are here (staff) and nowhere on a student route.
CREATE OR REPLACE FUNCTION tpo_list_drives(p_campus uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF tpo_role(p_campus) IS NULL THEN RETURN NULL; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', d.id, 'cohortId', d.cohort_id, 'title', d.title, 'link', d.link,
            'status', CASE WHEN d.status = 'closed' OR d.deadline < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'closed'
                           WHEN d.announced_at IS NULL THEN 'draft' ELSE 'live' END,
            'deadline', d.deadline, 'rounds', d.rounds, 'documents', d.documents,
            'scamRisk', d.scam_risk, 'scamFlags', d.scam_flags, 'criteria', d.criteria,
            'publishedAt', d.published_at, 'announcedAt', d.announced_at)
            ORDER BY d.published_at DESC, d.id), '[]'::jsonb)
            FROM drives d WHERE d.campus_id = p_campus);
END
$$;

-- ---------- notifications ----------
-- Four new kinds. Every one is a Home row (this table) and, by the sweep in services/notify, an email. A Home row is never
-- muted: a missed email loses nothing. The two critical kinds always email; the two others follow notification_prefs.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind CHECK (kind IN
  ('employer_message', 'application_update', 'drive_published', 'drive_closing', 'employer_reply', 'outcome_verified'));
ALTER TABLE notifications ADD COLUMN drive_id    uuid REFERENCES drives (id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN outcome_id  uuid REFERENCES outcomes (id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN dedupe_key  text;
-- Rows that already exist were mailed (or not) by the earlier code; the sweep only ever picks up 'pending'.
ALTER TABLE notifications ADD COLUMN email_state text NOT NULL DEFAULT 'skipped';
ALTER TABLE notifications ALTER COLUMN email_state SET DEFAULT 'skipped';
ALTER TABLE notifications ADD COLUMN emailed_at  timestamptz;
ALTER TABLE notifications ADD CONSTRAINT notifications_email_state CHECK (email_state IN ('pending', 'sent', 'skipped', 'failed'));
ALTER TABLE notifications ADD CONSTRAINT notifications_dedupe_len CHECK (dedupe_key IS NULL OR char_length(dedupe_key) BETWEEN 1 AND 200);
-- One notification per event per student: a repeated sweep cannot send twice.
CREATE UNIQUE INDEX notifications_dedupe_uq ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_email_pending_idx ON notifications (created_at) WHERE email_state = 'pending';

-- Per-student email preference for the non-critical kinds. A missing row means "send".
CREATE TABLE notification_prefs (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text        NOT NULL,
  email      boolean     NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind),
  CONSTRAINT notification_prefs_kind CHECK (kind IN ('drive_published', 'drive_closing'))
);
ALTER TABLE notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_prefs_own ON notification_prefs FOR ALL TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON notification_prefs FROM hirelane_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_prefs TO hirelane_app;

-- The unsubscribe token's hash (sha256 of the token that goes in the mail). Written by the mail sweep (owner role); the app
-- role has no access, only notify_unsubscribe below.
CREATE TABLE notification_unsub (
  user_id    uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  token_hash text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_unsub_hash_fmt CHECK (token_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE notification_unsub ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON notification_unsub FROM hirelane_app;

-- The mail's one-click link. The token, not a session, is the proof; it needs no user context. Turns email off for every
-- non-critical kind and answers how many kinds changed (0 for an unknown token; the service answers the same either way).
CREATE FUNCTION notify_unsubscribe(p_token_hash text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT u.user_id INTO v_user FROM notification_unsub u WHERE u.token_hash = p_token_hash;
  IF v_user IS NULL THEN RETURN 0; END IF;
  INSERT INTO notification_prefs (user_id, kind, email)
  SELECT v_user, k, false FROM unnest(ARRAY['drive_published', 'drive_closing']) AS k
  ON CONFLICT (user_id, kind) DO UPDATE SET email = false, updated_at = now();
  RETURN 2;
END
$$;

-- A verified offer is a Home row for the student, written in the same transaction as the verification (the TPO's session
-- cannot write another user's notifications, and the mail sweep, not this function, sends the email).
CREATE OR REPLACE FUNCTION tpo_verify_outcome(p_outcome_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := current_setting('hirelane.user_id')::uuid;
  o  outcomes%ROWTYPE;
BEGIN
  SELECT * INTO o FROM outcomes WHERE id = p_outcome_id;
  IF NOT FOUND OR tpo_role(o.campus_id) IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM cohort_members m WHERE m.user_id = o.user_id AND m.campus_id = o.campus_id AND m.share_level IN ('outcomes', 'full')) THEN
    RETURN NULL;
  END IF;
  UPDATE outcomes SET verification = 'tpo_verified', verified_by = me, verified_at = coalesce(verified_at, now()), updated_at = now()
   WHERE id = p_outcome_id;
  INSERT INTO tpo_access_log (campus_id, actor_id, subject_user_id, action) VALUES (o.campus_id, me, o.user_id, 'outcome_verify');
  IF o.kind = 'offer' THEN
    INSERT INTO notifications (user_id, kind, title, outcome_id, dedupe_key, email_state)
    VALUES (o.user_id, 'outcome_verified', left('Your offer from ' || o.employer || ' was verified by your placement cell', 200), o.id, 'outcome_verified:' || o.id::text, 'pending')
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN jsonb_build_object('id', o.id, 'verification', 'tpo_verified');
END
$$;

-- ---------- execute rights ----------
REVOKE ALL ON FUNCTION tpo_create_drive(uuid, text, text, text, jsonb, jsonb, text, date, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION tpo_announce_drive(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tpo_close_drive(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notify_unsubscribe(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tpo_create_drive(uuid, text, text, text, jsonb, jsonb, text, date, text, text, boolean) TO hirelane_app;
GRANT EXECUTE ON FUNCTION tpo_announce_drive(uuid) TO hirelane_app;
GRANT EXECUTE ON FUNCTION tpo_close_drive(uuid) TO hirelane_app;
GRANT EXECUTE ON FUNCTION notify_unsubscribe(text) TO hirelane_app;
