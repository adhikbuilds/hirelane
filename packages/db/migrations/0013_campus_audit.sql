-- 0013_campus_audit: findings from the security review of the campus slice (0011 / 0011a / 0011b are applied and checksum-locked).
--
--   1. tpo_import_roster no longer returns `matched` (it revealed whether one chosen student had joined), refuses imports under
--      k = 10 valid rows, accepts only rows on the campus's registered domains, and allows one import per cohort per 24 hours.
--      An import only STAGES the roster: verification and `placed` change in campus_apply_roster(), run by the nightly snapshot
--      job (not callable by the app role), so a TPO cannot flip one chosen student in or out of a published number.
--   2. Staff lifecycle: invites expire (14 days), the owner can remove staff and transfer ownership, every change is logged.
--   3. A campus_share consent row is written in the same transaction as a join (default level: aggregate).
--   4. Denial-of-service levers: the global join breaker only holds back callers who have failed recently; the college-email
--      OTP limits are per (mailbox, account) instead of per mailbox, with a larger per-mailbox ceiling for bombing.
--   5. At most 10 drives per cohort per 30 days (drive counts are released with an overlap check in the snapshot job).

ALTER TABLE cohort_members ADD COLUMN placed_changed_at timestamptz;
ALTER TABLE tpo_members ADD COLUMN expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days';
ALTER TABLE tpo_access_log DROP CONSTRAINT tpo_access_log_action;
ALTER TABLE tpo_access_log ADD CONSTRAINT tpo_access_log_action CHECK (action IN (
  'outcomes_list', 'outcome_verify', 'naac_export', 'letter_view', 'staff_invited', 'staff_removed', 'ownership_transferred'));

CREATE OR REPLACE FUNCTION campus_join_code(p_code_hmac text, p_cohort_id uuid, p_account_email_hmac text, p_ip_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me        uuid := current_setting('hirelane.user_id')::uuid;
  v_campus  campuses%ROWTYPE;
  v_attempt uuid;
  v_n       integer;
  v_roster  cohort_roster%ROWTYPE;
  v_email   text := p_account_email_hmac;
  v_member  cohort_members%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('campus_join:' || me::text, 0));
  DELETE FROM join_attempts WHERE at < now() - interval '2 days';

  SELECT count(*) INTO v_n FROM join_attempts WHERE user_id = me AND kind = 'code' AND at > now() - interval '15 minutes';
  IF v_n >= 10 THEN RETURN jsonb_build_object('status', 'rate_limited'); END IF;
  IF p_ip_hash IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM join_attempts WHERE ip_hash = p_ip_hash AND kind = 'code' AND at > now() - interval '15 minutes';
    IF v_n >= 60 THEN RETURN jsonb_build_object('status', 'rate_limited'); END IF;
  END IF;
  -- Circuit breaker against a distributed guess of the 40-bit code space.
  -- It holds back only callers who have themselves failed recently (3 misses in 15 minutes), so a crowd of throw-away accounts
  -- cannot lock every honest student out of joining.
  SELECT count(*) INTO v_n FROM join_attempts WHERE kind = 'code' AND NOT ok AND at > now() - interval '1 minute';
  IF v_n >= 300 AND (SELECT count(*) FROM join_attempts j WHERE j.user_id = me AND j.kind = 'code' AND NOT j.ok AND j.at > now() - interval '15 minutes') >= 3 THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;

  INSERT INTO join_attempts (user_id, kind, ip_hash, ok) VALUES (me, 'code', p_ip_hash, false) RETURNING id INTO v_attempt;

  IF EXISTS (SELECT 1 FROM cohort_members WHERE user_id = me) THEN
    RETURN jsonb_build_object('status', 'already_member');
  END IF;
  SELECT * INTO v_campus FROM campuses WHERE code_hmac = p_code_hmac;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid_code'); END IF;
  UPDATE join_attempts SET ok = true WHERE id = v_attempt;

  IF p_cohort_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'choose_cohort',
      'campus', jsonb_build_object('id', v_campus.id, 'name', v_campus.name),
      'cohorts', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'passoutYear', c.passout_year, 'programme', c.programme)
                                            ORDER BY c.passout_year DESC, lower(c.programme)), '[]'::jsonb)
                    FROM cohorts c WHERE c.campus_id = v_campus.id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cohorts c WHERE c.id = p_cohort_id AND c.campus_id = v_campus.id) THEN
    RETURN jsonb_build_object('status', 'invalid_cohort');
  END IF;

  -- The account mailbox counts only when it was proven at sign-in and nobody else holds that seat.
  IF v_email IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = me AND u.email_verified_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM cohort_members m WHERE m.campus_id = v_campus.id AND m.email_hmac = v_email) THEN
      v_email := NULL;
    END IF;
  END IF;
  IF v_email IS NOT NULL THEN
    SELECT * INTO v_roster FROM cohort_roster r WHERE r.cohort_id = p_cohort_id AND r.email_hmac = v_email;
  END IF;

  IF v_roster.id IS NOT NULL THEN
    INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac, placed)
    VALUES (me, v_campus.id, p_cohort_id, 'roster', now(), v_email, v_roster.placed) RETURNING * INTO v_member;
  ELSE
    INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, email_hmac)
    VALUES (me, v_campus.id, p_cohort_id, 'code', v_email) RETURNING * INTO v_member;
  END IF;
  -- Joining puts the student in the aggregate counts the placement cell sees, so that is recorded as a consent row now.
  INSERT INTO consents (user_id, kind, granted, doc_version) VALUES (me, 'campus_share', false, 'share-v1:aggregate');
  RETURN jsonb_build_object('status', 'joined', 'verifiedVia', v_member.verified_via);
END
$$;

CREATE OR REPLACE FUNCTION campus_email_join(p_challenge_id uuid, p_candidate_hash text, p_email_hmac text, p_cohort_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me       uuid := current_setting('hirelane.user_id')::uuid;
  v_o      otp_challenges%ROWTYPE;
  v_campus uuid;
  v_roster cohort_roster%ROWTYPE;
  v_via    text := 'email';
  v_placed boolean := false;
BEGIN
  SELECT o.* INTO v_o FROM otp_challenges o
   WHERE o.id = p_challenge_id AND o.user_id = me AND o.purpose = 'campus_email' AND o.target_hmac = p_email_hmac
     AND o.consumed_at IS NULL AND o.expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF digest(v_o.code_hash, 'sha256') IS DISTINCT FROM digest(p_candidate_hash, 'sha256') THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  SELECT b.campus_id INTO v_campus FROM campus_otp_bindings b WHERE b.challenge_id = p_challenge_id AND b.user_id = me;
  IF v_campus IS NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF EXISTS (SELECT 1 FROM cohort_members WHERE user_id = me) THEN RETURN jsonb_build_object('status', 'already_member'); END IF;
  IF NOT EXISTS (SELECT 1 FROM cohorts c WHERE c.id = p_cohort_id AND c.campus_id = v_campus) THEN
    RETURN jsonb_build_object('status', 'invalid_cohort');
  END IF;

  BEGIN
    UPDATE otp_challenges SET consumed_at = now() WHERE id = p_challenge_id AND consumed_at IS NULL;
    SELECT * INTO v_roster FROM cohort_roster r WHERE r.cohort_id = p_cohort_id AND r.email_hmac = p_email_hmac;
    IF v_roster.id IS NOT NULL THEN v_placed := v_roster.placed; END IF;
    INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac, placed)
    VALUES (me, v_campus, p_cohort_id, v_via, now(), p_email_hmac, v_placed);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'seat_taken');
  END;
  INSERT INTO consents (user_id, kind, granted, doc_version) VALUES (me, 'campus_share', false, 'share-v1:aggregate');
  RETURN jsonb_build_object('status', 'joined', 'verifiedVia', v_via);
END
$$;

CREATE OR REPLACE FUNCTION campus_email_issue(p_email_hmac text, p_domain text, p_challenge_id uuid, p_code_hash text, p_ip_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me       uuid := current_setting('hirelane.user_id')::uuid;
  v_campus uuid;
  v_n      integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('campus_join:' || me::text, 0));
  SELECT count(*) INTO v_n FROM join_attempts WHERE user_id = me AND kind = 'email_send' AND at > now() - interval '15 minutes';
  IF v_n >= 5 THEN RETURN jsonb_build_object('status', 'rate_limited'); END IF;
  IF p_ip_hash IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM join_attempts WHERE ip_hash = p_ip_hash AND kind = 'email_send' AND at > now() - interval '15 minutes';
    IF v_n >= 30 THEN RETURN jsonb_build_object('status', 'rate_limited'); END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM join_attempts WHERE user_id = me AND kind = 'email_send' AND at > now() - interval '60 seconds') THEN
    RETURN jsonb_build_object('status', 'cooldown');
  END IF;
  INSERT INTO join_attempts (user_id, kind, ip_hash, ok) VALUES (me, 'email_send', p_ip_hash, false);

  -- Per mailbox, from any account: one mail a minute, ten a day (the login flow's values). Counted from the challenges
  -- themselves, retired or not.
  IF EXISTS (SELECT 1 FROM otp_challenges o WHERE o.target_hmac = p_email_hmac AND o.purpose = 'campus_email' AND o.created_at > now() - interval '60 seconds') THEN
    RETURN jsonb_build_object('status', 'cooldown');
  END IF;
  -- Ten a day per (mailbox, account), so a stranger cannot use up a victim's allowance; forty a day per mailbox overall so the
  -- mailbox itself cannot be bombed from many accounts.
  SELECT count(*) INTO v_n FROM otp_challenges o WHERE o.target_hmac = p_email_hmac AND o.purpose = 'campus_email' AND o.user_id = me AND o.created_at > now() - interval '24 hours';
  IF v_n >= 10 THEN RETURN jsonb_build_object('status', 'rate_limited'); END IF;
  SELECT count(*) INTO v_n FROM otp_challenges o WHERE o.target_hmac = p_email_hmac AND o.purpose = 'campus_email' AND o.created_at > now() - interval '24 hours';
  IF v_n >= 40 THEN RETURN jsonb_build_object('status', 'rate_limited'); END IF;

  IF EXISTS (SELECT 1 FROM cohort_members WHERE user_id = me) THEN
    RETURN jsonb_build_object('status', 'already_member');
  END IF;
  SELECT d.campus_id INTO v_campus FROM campus_domains d WHERE d.domain = lower(p_domain)::citext;
  IF v_campus IS NULL THEN RETURN jsonb_build_object('status', 'unknown_domain'); END IF;

  -- Only this person's newest code works. Another account's open code for the same mailbox is left alone, so a stranger
  -- cannot cancel it by asking for a code of their own.
  UPDATE otp_challenges SET consumed_at = now()
   WHERE target_hmac = p_email_hmac AND purpose = 'campus_email' AND user_id = me AND consumed_at IS NULL;
  INSERT INTO otp_challenges (id, channel, purpose, target_hmac, code_hash, expires_at, ip_hash, user_id)
  VALUES (p_challenge_id, 'email', 'campus_email', p_email_hmac, p_code_hash, now() + interval '10 minutes', p_ip_hash, me);
  INSERT INTO campus_otp_bindings (challenge_id, user_id, campus_id) VALUES (p_challenge_id, me, v_campus);
  UPDATE join_attempts SET ok = true
   WHERE id = (SELECT j.id FROM join_attempts j WHERE j.user_id = me AND j.kind = 'email_send' ORDER BY j.at DESC LIMIT 1);
  RETURN jsonb_build_object('status', 'sent');
END
$$;

CREATE OR REPLACE FUNCTION campus_email_spend(p_email_hmac text, p_ip_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me  uuid := current_setting('hirelane.user_id')::uuid;
  v_n integer;
  r   record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('campus_join:' || me::text, 0));
  SELECT count(*) INTO v_n FROM join_attempts WHERE user_id = me AND kind = 'email_verify' AND at > now() - interval '15 minutes';
  IF v_n >= 12 THEN RETURN jsonb_build_object('status', 'rate_limited'); END IF;
  INSERT INTO join_attempts (user_id, kind, ip_hash, ok) VALUES (me, 'email_verify', p_ip_hash, false);

  -- Per (mailbox, account), across that account's challenges: ten guesses an hour. A request for a new code does not reset it. Another
  -- account's guesses cannot use it up: a code is only ever spendable by the account it was issued to.
  SELECT coalesce(sum(o.attempts), 0) INTO v_n FROM otp_challenges o
   WHERE o.target_hmac = p_email_hmac AND o.purpose = 'campus_email' AND o.user_id = me AND o.created_at > now() - interval '1 hour';
  IF v_n >= 10 THEN RETURN jsonb_build_object('status', 'rate_limited'); END IF;

  UPDATE otp_challenges SET attempts = attempts + 1
   WHERE id = (SELECT o.id FROM otp_challenges o JOIN campus_otp_bindings b ON b.challenge_id = o.id
                WHERE o.target_hmac = p_email_hmac AND o.purpose = 'campus_email' AND o.user_id = me
                  AND o.consumed_at IS NULL AND o.expires_at > now() AND o.attempts < 5
                ORDER BY o.created_at DESC LIMIT 1)
     AND consumed_at IS NULL AND attempts < 5
  RETURNING id, code_hash INTO r;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'none'); END IF;
  RETURN jsonb_build_object('status', 'spent', 'challengeId', r.id, 'codeHash', r.code_hash);
END
$$;

CREATE OR REPLACE FUNCTION tpo_claim_invites(p_email_hmac text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := current_setting('hirelane.user_id')::uuid;
  n  integer;
BEGIN
  UPDATE tpo_members t SET user_id = me, claimed_at = now()
   WHERE t.user_id IS NULL AND t.email_hmac = p_email_hmac AND t.expires_at > now()
     AND EXISTS (SELECT 1 FROM users u WHERE u.id = me AND u.email_verified_at IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM tpo_members x WHERE x.campus_id = t.campus_id AND x.user_id = me);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- Owner only. Status: invited | exists. An expired, unclaimed invite is re-issued.
CREATE OR REPLACE FUNCTION tpo_invite_staff(p_campus uuid, p_email_hmac text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := current_setting('hirelane.user_id')::uuid;
  t  tpo_members%ROWTYPE;
BEGIN
  IF tpo_role(p_campus) IS DISTINCT FROM 'owner' THEN RETURN NULL; END IF;
  SELECT * INTO t FROM tpo_members x WHERE x.campus_id = p_campus AND x.email_hmac = p_email_hmac;
  IF FOUND THEN
    IF t.user_id IS NULL AND t.expires_at <= now() THEN
      UPDATE tpo_members SET expires_at = now() + interval '14 days', invited_by = me, created_at = now() WHERE id = t.id;
      INSERT INTO tpo_access_log (campus_id, actor_id, subject_user_id, action) VALUES (p_campus, me, me, 'staff_invited');
      RETURN jsonb_build_object('status', 'invited');
    END IF;
    RETURN jsonb_build_object('status', 'exists');
  END IF;
  INSERT INTO tpo_members (campus_id, email_hmac, role, invited_by) VALUES (p_campus, p_email_hmac, 'staff', me);
  INSERT INTO tpo_access_log (campus_id, actor_id, subject_user_id, action) VALUES (p_campus, me, me, 'staff_invited');
  RETURN jsonb_build_object('status', 'invited');
END
$$;

CREATE OR REPLACE FUNCTION tpo_list_staff(p_campus uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF tpo_role(p_campus) IS DISTINCT FROM 'owner' THEN RETURN NULL; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'role', t.role, 'claimed', t.user_id IS NOT NULL, 'createdAt', t.created_at,
                                                       'expiresAt', CASE WHEN t.user_id IS NULL THEN t.expires_at END,
                                                       'expired', t.user_id IS NULL AND t.expires_at <= now())
                                    ORDER BY t.created_at, t.id), '[]'::jsonb)
            FROM tpo_members t WHERE t.campus_id = p_campus);
END
$$;

-- Owner only. Removes a staff seat (claimed or an open invite). The last owner cannot be removed. Status: removed | last_owner
CREATE FUNCTION tpo_remove_staff(p_campus uuid, p_member_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := current_setting('hirelane.user_id')::uuid;
  t  tpo_members%ROWTYPE;
BEGIN
  IF tpo_role(p_campus) IS DISTINCT FROM 'owner' THEN RETURN NULL; END IF;
  SELECT * INTO t FROM tpo_members x WHERE x.id = p_member_id AND x.campus_id = p_campus FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF t.role = 'owner' AND (SELECT count(*) FROM tpo_members o WHERE o.campus_id = p_campus AND o.role = 'owner' AND o.user_id IS NOT NULL) <= 1 THEN
    RETURN jsonb_build_object('status', 'last_owner');
  END IF;
  DELETE FROM tpo_members WHERE id = t.id;
  INSERT INTO tpo_access_log (campus_id, actor_id, subject_user_id, action) VALUES (p_campus, me, coalesce(t.user_id, me), 'staff_removed');
  RETURN jsonb_build_object('status', 'removed');
END
$$;

-- Owner only. The target must be a claimed staff member; the caller becomes staff. Status: transferred
CREATE FUNCTION tpo_transfer_ownership(p_campus uuid, p_member_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := current_setting('hirelane.user_id')::uuid;
  t  tpo_members%ROWTYPE;
BEGIN
  IF tpo_role(p_campus) IS DISTINCT FROM 'owner' THEN RETURN NULL; END IF;
  SELECT * INTO t FROM tpo_members x WHERE x.id = p_member_id AND x.campus_id = p_campus AND x.user_id IS NOT NULL AND x.user_id <> me FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE tpo_members SET role = 'owner' WHERE id = t.id;
  UPDATE tpo_members SET role = 'staff' WHERE campus_id = p_campus AND user_id = me;
  INSERT INTO tpo_access_log (campus_id, actor_id, subject_user_id, action) VALUES (p_campus, me, t.user_id, 'ownership_transferred');
  RETURN jsonb_build_object('status', 'transferred');
END
$$;

-- p_rows: [{"h": email hmac, "d": mailbox domain, "placed": bool}], de-duplicated and capped by the service. Only rows whose
-- domain is registered for the campus are kept. Status: imported | too_few | rate_limited. NOTHING is returned about which
-- rows matched a member, and nothing changes for any member here: see campus_apply_roster.
CREATE OR REPLACE FUNCTION tpo_import_roster(p_cohort_id uuid, p_rows jsonb, p_total integer, p_rejected integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campus uuid := tpo_campus_of_cohort(p_cohort_id);
  v_valid  integer;
  v_rows   integer;
BEGIN
  IF v_campus IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 20000 THEN
    RAISE EXCEPTION 'roster rows must be an array of at most 20000' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM cohort_imports i WHERE i.cohort_id = p_cohort_id AND i.created_at > now() - interval '24 hours') THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;
  v_rows := jsonb_array_length(p_rows);
  SELECT count(DISTINCT r ->> 'h') INTO v_valid FROM jsonb_array_elements(p_rows) AS r
   WHERE EXISTS (SELECT 1 FROM campus_domains d WHERE d.campus_id = v_campus AND d.domain = lower(r ->> 'd')::citext);
  IF v_valid < 10 THEN RETURN jsonb_build_object('status', 'too_few'); END IF;
  INSERT INTO cohort_roster (campus_id, cohort_id, email_hmac, placed)
  SELECT DISTINCT ON (r ->> 'h') v_campus, p_cohort_id, r ->> 'h', coalesce((r ->> 'placed')::boolean, false)
    FROM jsonb_array_elements(p_rows) AS r
   WHERE EXISTS (SELECT 1 FROM campus_domains d WHERE d.campus_id = v_campus AND d.domain = lower(r ->> 'd')::citext)
  ON CONFLICT (cohort_id, email_hmac) DO UPDATE SET placed = EXCLUDED.placed, imported_at = now();
  INSERT INTO cohort_imports (campus_id, cohort_id, actor_id, rows_total, rows_valid, rows_rejected, matched)
  VALUES (v_campus, p_cohort_id, current_setting('hirelane.user_id')::uuid, p_total, v_valid, p_rejected + (v_rows - v_valid), 0);
  RETURN jsonb_build_object('status', 'imported', 'rowsTotal', p_total, 'rowsValid', v_valid, 'rowsRejected', p_rejected + (v_rows - v_valid));
END
$$;

-- Applies the staged roster to members: a member whose proven mailbox is on the roster becomes verified (roster) and takes the
-- placed flag. Called by the nightly snapshot job BEFORE it counts, as the owner role; the app role cannot execute it. Returns
-- the ids of members whose `placed` changed, so the snapshot can leave them out of that day's drive populations.
CREATE FUNCTION campus_apply_roster() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed jsonb;
BEGIN
  WITH upd AS (
    UPDATE cohort_members m
       SET placed = r.placed,
           placed_changed_at = CASE WHEN m.placed IS DISTINCT FROM r.placed THEN now() ELSE m.placed_changed_at END,
           verified_via = CASE WHEN m.verified_via = 'code' THEN 'roster' ELSE m.verified_via END,
           verified_at = coalesce(m.verified_at, now()),
           updated_at = now()
      FROM cohort_roster r
     WHERE r.cohort_id = m.cohort_id AND m.email_hmac = r.email_hmac
       AND (m.placed IS DISTINCT FROM r.placed OR m.verified_at IS NULL)
    RETURNING m.user_id
  )
  SELECT coalesce(jsonb_agg(user_id), '[]'::jsonb) INTO v_changed FROM upd;
  RETURN v_changed;
END
$$;

CREATE OR REPLACE FUNCTION tpo_publish_drive(p_cohort_id uuid, p_title text, p_link text, p_notice text, p_criteria jsonb, p_flags jsonb, p_risk text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campus uuid := tpo_campus_of_cohort(p_cohort_id);
  v_id     uuid;
BEGIN
  IF v_campus IS NULL THEN RETURN NULL; END IF;
  -- Many near-identical drives are a way to difference one student out of the counts: cap them.
  IF (SELECT count(*) FROM drives d WHERE d.cohort_id = p_cohort_id AND d.published_at > now() - interval '30 days') >= 10 THEN
    RAISE EXCEPTION 'drive limit reached for this cohort' USING ERRCODE = 'check_violation', CONSTRAINT = 'drives_per_cohort_limit';
  END IF;
  INSERT INTO drives (campus_id, cohort_id, title, link, notice_text, criteria, scam_flags, scam_risk, created_by)
  VALUES (v_campus, p_cohort_id, p_title, p_link, p_notice, p_criteria, p_flags, p_risk, current_setting('hirelane.user_id')::uuid)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION tpo_remove_staff(uuid, uuid), tpo_transfer_ownership(uuid, uuid), campus_apply_roster() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tpo_remove_staff(uuid, uuid), tpo_transfer_ownership(uuid, uuid) TO hirelane_app;
