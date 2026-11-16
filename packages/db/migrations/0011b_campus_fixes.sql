-- 0011b_campus_fixes: findings from the review of 0011 / 0011a (those two files are applied and checksum-locked, so the
-- fixes are CREATE OR REPLACE here; every body restates SECURITY DEFINER and the pinned search_path, and the existing
-- EXECUTE grants stay as they are).
--
--   1. tpo_list_outcomes applied a student's CURRENT share level to outcomes reported at a campus they had since left:
--      the join to cohort_members did not match campus_id, so a student who reported at campus A, left, and joined campus B
--      at level `full` was still listed to A's TPO, with their email, and logged. The membership must be at the outcome's campus.
--   2. The college-email OTP had per-user, per-IP and per-challenge limits but no per-mailbox ones, unlike the login flow:
--        send:   one mail per mailbox per minute and ten per day, from any account;
--        verify: ten attempts per mailbox per hour across all challenges and all accounts, so rotating fresh codes (or
--                accounts) cannot brute-force a victim's six digits, and a new request from one account no longer
--                retires another account's open code.

CREATE OR REPLACE FUNCTION tpo_list_outcomes(p_campus uuid, p_cohort_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me    uuid := current_setting('hirelane.user_id')::uuid;
  v_out jsonb;
BEGIN
  IF tpo_role(p_campus) IS NULL THEN RETURN NULL; END IF;
  INSERT INTO tpo_access_log (campus_id, actor_id, subject_user_id, action)
  SELECT p_campus, me, x.user_id, 'outcomes_list'
    FROM (SELECT DISTINCT o.user_id FROM outcomes o
            JOIN cohort_members m ON m.user_id = o.user_id AND m.campus_id = o.campus_id
           WHERE o.campus_id = p_campus AND m.share_level IN ('outcomes', 'full') AND (p_cohort_id IS NULL OR o.cohort_id = p_cohort_id)) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'kind', o.kind, 'employer', o.employer, 'roleTitle', o.role_title, 'packageLpa', o.package_lpa,
           'verification', o.verification, 'createdAt', o.created_at, 'verifiedAt', o.verified_at,
           'studentName', u.display_name,
           'studentEmail', CASE WHEN m.share_level = 'full' THEN u.email::text ELSE NULL END,
           'memberVerified', m.verified_at IS NOT NULL,
           'programme', c.programme, 'passoutYear', c.passout_year, 'cohortId', o.cohort_id,
           'hasLetter', o.letter_enc IS NOT NULL
                        AND coalesce((SELECT k.granted FROM consents k WHERE k.user_id = o.user_id AND k.kind = 'offer_letter_tpo'
                                       ORDER BY k.at DESC, k.id DESC LIMIT 1), false))
           ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_out
    FROM outcomes o
    JOIN cohort_members m ON m.user_id = o.user_id AND m.campus_id = o.campus_id
    JOIN users u ON u.id = o.user_id
    JOIN cohorts c ON c.id = o.cohort_id
   WHERE o.campus_id = p_campus AND m.share_level IN ('outcomes', 'full') AND (p_cohort_id IS NULL OR o.cohort_id = p_cohort_id);
  RETURN v_out;
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
  SELECT count(*) INTO v_n FROM otp_challenges o WHERE o.target_hmac = p_email_hmac AND o.purpose = 'campus_email' AND o.created_at > now() - interval '24 hours';
  IF v_n >= 10 THEN RETURN jsonb_build_object('status', 'rate_limited'); END IF;

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

  -- Per mailbox, across every challenge and every account: ten guesses an hour. A request for a new code does not reset it.
  SELECT coalesce(sum(o.attempts), 0) INTO v_n FROM otp_challenges o
   WHERE o.target_hmac = p_email_hmac AND o.purpose = 'campus_email' AND o.created_at > now() - interval '1 hour';
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
