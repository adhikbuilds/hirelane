-- 0011a_campus_functions: the SECURITY DEFINER doors into the campus tables (Amendment B section 15).
--
-- Rules every function here follows (verify-rls checks them for the whole schema):
--   * SECURITY DEFINER, owned by the migration role, `SET search_path = public, pg_temp`.
--   * EXECUTE is revoked from PUBLIC; only the functions the app calls are granted to hirelane_app.
--   * The caller is read from current_setting('hirelane.user_id') (no parameter ever names the acting user). With no user
--     context the function errors, it does not return rows.
--   * A caller who is not staff of the campus gets NULL back, and the service answers 404, so existence is never revealed.
--   * Writes that must persist a refusal (rate limits, failed code checks) RETURN a status instead of raising, so the
--     attempt row is committed with the transaction.
--
-- Suppression (k = 10 over VERIFIED members): a cell is hidden when n < 10 or P - n < 10; when exactly one cell of an
-- exclusive group is hidden, the smallest other cell is hidden too (complementary suppression), so it cannot be rebuilt as
-- total minus the rest; shown counts are rounded to the nearest 5; only the latest snapshot day is ever returned (no
-- series to difference); dimensions are the fixed metric list below and callers pass no filters.

-- ---------- pure helper: suppression and rounding ----------
-- cells: [{"metric": text, "n": int, "p": int, "group": text|null, "total": bool}]. A "total" cell is the population
-- itself (n = p), so only n < k hides it. Returns [{"metric","value","suppressed"}] in the same order.
CREATE FUNCTION campus_release_cells(p_cells jsonb, p_k integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  len    integer := coalesce(jsonb_array_length(p_cells), 0);
  names  text[];
  ns     integer[];
  ps     integer[];
  grp    text[];
  tot    boolean[];
  sup    boolean[];
  i      integer;
  g      text;
  cnt    integer;
  best   integer;
  result jsonb := '[]'::jsonb;
BEGIN
  FOR i IN 1..len LOOP
    names[i] := p_cells -> (i - 1) ->> 'metric';
    ns[i]    := (p_cells -> (i - 1) ->> 'n')::integer;
    ps[i]    := (p_cells -> (i - 1) ->> 'p')::integer;
    grp[i]   := p_cells -> (i - 1) ->> 'group';
    tot[i]   := coalesce((p_cells -> (i - 1) ->> 'total')::boolean, false);
    sup[i]   := ns[i] < p_k OR (NOT tot[i] AND ps[i] - ns[i] < p_k);
  END LOOP;

  FOR g IN SELECT DISTINCT x FROM unnest(grp) AS x WHERE x IS NOT NULL LOOP
    cnt := 0;
    FOR i IN 1..len LOOP
      IF grp[i] = g AND sup[i] THEN cnt := cnt + 1; END IF;
    END LOOP;
    IF cnt = 1 THEN
      best := NULL;
      FOR i IN 1..len LOOP
        IF grp[i] = g AND NOT sup[i] AND (best IS NULL OR ns[i] < ns[best]) THEN best := i; END IF;
      END LOOP;
      IF best IS NOT NULL THEN sup[best] := true; END IF;
    END IF;
  END LOOP;

  FOR i IN 1..len LOOP
    result := result || jsonb_build_array(jsonb_build_object(
      'metric', names[i],
      'value', CASE WHEN sup[i] THEN NULL ELSE (ns[i] + 2) / 5 * 5 END,
      'suppressed', sup[i]));
  END LOOP;
  RETURN result;
END
$$;

-- ---------- staff helpers (not callable by the app role) ----------
CREATE FUNCTION tpo_role(p_campus uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.role FROM tpo_members t WHERE t.campus_id = p_campus AND t.user_id = current_setting('hirelane.user_id')::uuid
$$;

-- The campus of a cohort, only when the caller is staff there.
CREATE FUNCTION tpo_campus_of_cohort(p_cohort_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.campus_id FROM cohorts c
    JOIN tpo_members t ON t.campus_id = c.campus_id AND t.user_id = current_setting('hirelane.user_id')::uuid
   WHERE c.id = p_cohort_id
$$;

-- ---------- joining ----------
-- Join by campus code. With p_cohort_id null it only checks the code and lists the cohorts to pick from.
-- Status: joined | choose_cohort | invalid_code | invalid_cohort | already_member | rate_limited
CREATE FUNCTION campus_join_code(p_code_hmac text, p_cohort_id uuid, p_account_email_hmac text, p_ip_hash text) RETURNS jsonb
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
  SELECT count(*) INTO v_n FROM join_attempts WHERE kind = 'code' AND NOT ok AND at > now() - interval '1 minute';
  IF v_n >= 300 THEN RETURN jsonb_build_object('status', 'rate_limited'); END IF;

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
  RETURN jsonb_build_object('status', 'joined', 'verifiedVia', v_member.verified_via);
END
$$;

-- Start a college-email join: bind a campus_email challenge to the campus that owns the domain.
-- The caller's service computes the code hash; the plain code never reaches SQL.
-- Status: sent | unknown_domain | already_member | cooldown | rate_limited
CREATE FUNCTION campus_email_issue(p_email_hmac text, p_domain text, p_challenge_id uuid, p_code_hash text, p_ip_hash text) RETURNS jsonb
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

  IF EXISTS (SELECT 1 FROM cohort_members WHERE user_id = me) THEN
    RETURN jsonb_build_object('status', 'already_member');
  END IF;
  SELECT d.campus_id INTO v_campus FROM campus_domains d WHERE d.domain = lower(p_domain)::citext;
  IF v_campus IS NULL THEN RETURN jsonb_build_object('status', 'unknown_domain'); END IF;

  -- Only the newest code works (same rule as issueChallenge).
  UPDATE otp_challenges SET consumed_at = now()
   WHERE target_hmac = p_email_hmac AND purpose = 'campus_email' AND consumed_at IS NULL;
  INSERT INTO otp_challenges (id, channel, purpose, target_hmac, code_hash, expires_at, ip_hash, user_id)
  VALUES (p_challenge_id, 'email', 'campus_email', p_email_hmac, p_code_hash, now() + interval '10 minutes', p_ip_hash, me);
  INSERT INTO campus_otp_bindings (challenge_id, user_id, campus_id) VALUES (p_challenge_id, me, v_campus);
  UPDATE join_attempts SET ok = true
   WHERE id = (SELECT j.id FROM join_attempts j WHERE j.user_id = me AND j.kind = 'email_send' ORDER BY j.at DESC LIMIT 1);
  RETURN jsonb_build_object('status', 'sent');
END
$$;

-- Spend one verification attempt on the newest open campus_email challenge for this mailbox, in the same UPDATE that
-- finds it (so the 6th try fails even with the right code, and parallel guesses cannot both slip under the limit).
-- Returns the stored hash so the service can compare in constant time. Status: spent | none | rate_limited
CREATE FUNCTION campus_email_spend(p_email_hmac text, p_ip_hash text) RETURNS jsonb
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

-- Finish the college-email join. The campus comes from the challenge binding, never from the caller. The hash comparison
-- runs over SHA-256 digests. Seat uniqueness (one mailbox, one seat) rolls the consumption back, so a taken seat does not
-- burn the code. Status: joined | invalid | invalid_cohort | already_member | seat_taken
CREATE FUNCTION campus_email_join(p_challenge_id uuid, p_candidate_hash text, p_email_hmac text, p_cohort_id uuid) RETURNS jsonb
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
  RETURN jsonb_build_object('status', 'joined', 'verifiedVia', v_via);
END
$$;

CREATE FUNCTION campus_leave() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM cohort_members WHERE user_id = current_setting('hirelane.user_id')::uuid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END
$$;

-- ---------- TPO: identity ----------
-- Claims invites that were sent to this person's mailbox. The service passes the HMAC of the account email; the
-- account's email must be verified. Returns how many seats were claimed.
CREATE FUNCTION tpo_claim_invites(p_email_hmac text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := current_setting('hirelane.user_id')::uuid;
  n  integer;
BEGIN
  UPDATE tpo_members t SET user_id = me, claimed_at = now()
   WHERE t.user_id IS NULL AND t.email_hmac = p_email_hmac
     AND EXISTS (SELECT 1 FROM users u WHERE u.id = me AND u.email_verified_at IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM tpo_members x WHERE x.campus_id = t.campus_id AND x.user_id = me);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

CREATE FUNCTION tpo_memberships() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('campusId', c.id, 'campusName', c.name, 'role', t.role) ORDER BY c.name), '[]'::jsonb)
    FROM tpo_members t JOIN campuses c ON c.id = t.campus_id
   WHERE t.user_id = current_setting('hirelane.user_id')::uuid
$$;

-- ---------- TPO: cohorts and stats ----------
CREATE FUNCTION tpo_create_cohort(p_campus uuid, p_year integer, p_programme text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF tpo_role(p_campus) IS NULL THEN RETURN NULL; END IF;
  SELECT c.id INTO v_id FROM cohorts c WHERE c.campus_id = p_campus AND c.passout_year = p_year AND lower(c.programme) = lower(p_programme);
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('id', v_id, 'created', false); END IF;
  INSERT INTO cohorts (campus_id, passout_year, programme) VALUES (p_campus, p_year, p_programme) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'created', true);
END
$$;

CREATE FUNCTION tpo_list_cohorts(p_campus uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r      record;
  v_day  date;
  v_n    integer;
  v_rel  jsonb;
  v_out  jsonb := '[]'::jsonb;
BEGIN
  IF tpo_role(p_campus) IS NULL THEN RETURN NULL; END IF;
  FOR r IN SELECT c.id, c.passout_year, c.programme FROM cohorts c WHERE c.campus_id = p_campus ORDER BY c.passout_year DESC, lower(c.programme) LOOP
    v_day := NULL; v_n := NULL; v_rel := NULL;
    SELECT s.day, s.n INTO v_day, v_n FROM cohort_stats_daily s
     WHERE s.cohort_id = r.id AND s.metric = 'joined_verified' ORDER BY s.day DESC LIMIT 1;
    IF v_day IS NOT NULL THEN
      v_rel := campus_release_cells(jsonb_build_array(jsonb_build_object('metric', 'joined_verified', 'n', v_n, 'p', v_n, 'total', true))) -> 0;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'passoutYear', r.passout_year, 'programme', r.programme,
      'rosterSize', (SELECT count(*) FROM cohort_roster x WHERE x.cohort_id = r.id),
      'snapshotDay', v_day,
      'joined', CASE WHEN v_rel IS NULL THEN NULL ELSE v_rel -> 'value' END,
      'joinedSuppressed', CASE WHEN v_rel IS NULL THEN true ELSE (v_rel ->> 'suppressed')::boolean END));
  END LOOP;
  RETURN v_out;
END
$$;

-- The fixed metric list. Population P is the cohort's verified members unless noted:
--   joined_verified         total of verified members
--   stage_*                 exclusive and exhaustive over P: no resume / resume not confirmed / eligibility confirmed
--   ats_readable            of members with a resume: a text-layer resume an ATS can read
--   blocker_*               of members with a confirmed eligibility profile: who fails a common cutoff
--   interview_reported, offer_reported, placed_on_roster   of P
CREATE FUNCTION tpo_cohort_stats(p_cohort_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day   date;
  v_cells jsonb;
  v_rel   jsonb;
  v_names text[] := ARRAY['joined_verified', 'stage_no_resume', 'stage_resume_unconfirmed', 'stage_confirmed', 'ats_readable',
                          'blocker_active_backlog', 'blocker_grad_below_60', 'blocker_secondary_below_60', 'blocker_gap_year',
                          'interview_reported', 'offer_reported', 'placed_on_roster'];
BEGIN
  IF tpo_campus_of_cohort(p_cohort_id) IS NULL THEN RETURN NULL; END IF;
  SELECT max(s.day) INTO v_day FROM cohort_stats_daily s WHERE s.cohort_id = p_cohort_id AND s.metric = 'joined_verified';
  IF v_day IS NULL THEN RETURN jsonb_build_object('day', NULL, 'metrics', '[]'::jsonb); END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'metric', s.metric, 'n', s.n, 'p', s.p,
           'group', CASE WHEN s.metric LIKE 'stage\_%' THEN 'stage' ELSE NULL END,
           'total', s.metric = 'joined_verified') ORDER BY array_position(v_names, s.metric)), '[]'::jsonb)
    INTO v_cells
    FROM cohort_stats_daily s
   WHERE s.cohort_id = p_cohort_id AND s.day = v_day AND s.metric = ANY (v_names);
  v_rel := campus_release_cells(v_cells);
  RETURN jsonb_build_object('day', v_day, 'metrics', v_rel);
END
$$;

-- ---------- TPO: drives ----------
CREATE FUNCTION tpo_publish_drive(p_cohort_id uuid, p_title text, p_link text, p_notice text, p_criteria jsonb, p_flags jsonb, p_risk text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campus uuid := tpo_campus_of_cohort(p_cohort_id);
  v_id     uuid;
BEGIN
  IF v_campus IS NULL THEN RETURN NULL; END IF;
  INSERT INTO drives (campus_id, cohort_id, title, link, notice_text, criteria, scam_flags, scam_risk, created_by)
  VALUES (v_campus, p_cohort_id, p_title, p_link, p_notice, p_criteria, p_flags, p_risk, current_setting('hirelane.user_id')::uuid)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

CREATE FUNCTION tpo_list_drives(p_campus uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF tpo_role(p_campus) IS NULL THEN RETURN NULL; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', d.id, 'cohortId', d.cohort_id, 'title', d.title, 'link', d.link, 'status', d.status,
            'scamRisk', d.scam_risk, 'scamFlags', d.scam_flags, 'criteria', d.criteria, 'publishedAt', d.published_at)
            ORDER BY d.published_at DESC), '[]'::jsonb)
            FROM drives d WHERE d.campus_id = p_campus);
END
$$;

-- Counts of members for whom a drive is eligible / unknown / ineligible, from the nightly snapshot.
CREATE FUNCTION tpo_drive_counts(p_drive_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cohort uuid;
  v_day    date;
  v_cells  jsonb;
BEGIN
  SELECT d.cohort_id INTO v_cohort FROM drives d WHERE d.id = p_drive_id;
  IF v_cohort IS NULL OR tpo_campus_of_cohort(v_cohort) IS NULL THEN RETURN NULL; END IF;
  SELECT max(s.day) INTO v_day FROM cohort_stats_daily s WHERE s.cohort_id = v_cohort AND s.metric = 'drive_eligible:' || p_drive_id::text;
  IF v_day IS NULL THEN RETURN jsonb_build_object('day', NULL, 'metrics', '[]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('metric', split_part(s.metric, ':', 1), 'n', s.n, 'p', s.p, 'group', 'drive', 'total', false)
                            ORDER BY s.metric), '[]'::jsonb)
    INTO v_cells
    FROM cohort_stats_daily s
   WHERE s.cohort_id = v_cohort AND s.day = v_day
     AND s.metric IN ('drive_eligible:' || p_drive_id::text, 'drive_unknown:' || p_drive_id::text, 'drive_ineligible:' || p_drive_id::text);
  RETURN jsonb_build_object('day', v_day, 'metrics', campus_release_cells(v_cells));
END
$$;

-- ---------- TPO: outcomes ----------
-- Only students at share level outcomes or full are visible. Each student returned is logged for that student.
CREATE FUNCTION tpo_list_outcomes(p_campus uuid, p_cohort_id uuid) RETURNS jsonb
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
    FROM (SELECT DISTINCT o.user_id FROM outcomes o JOIN cohort_members m ON m.user_id = o.user_id
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
    JOIN cohort_members m ON m.user_id = o.user_id
    JOIN users u ON u.id = o.user_id
    JOIN cohorts c ON c.id = o.cohort_id
   WHERE o.campus_id = p_campus AND m.share_level IN ('outcomes', 'full') AND (p_cohort_id IS NULL OR o.cohort_id = p_cohort_id);
  RETURN v_out;
END
$$;

CREATE FUNCTION tpo_verify_outcome(p_outcome_id uuid) RETURNS jsonb
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
  RETURN jsonb_build_object('id', o.id, 'verification', 'tpo_verified');
END
$$;

-- The sealed letter, only when the student attached one, is at share level outcomes or full, and their latest
-- offer_letter_tpo consent is granted. Logged for the student.
CREATE FUNCTION tpo_outcome_letter(p_outcome_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := current_setting('hirelane.user_id')::uuid;
  o  outcomes%ROWTYPE;
BEGIN
  SELECT * INTO o FROM outcomes WHERE id = p_outcome_id;
  IF NOT FOUND OR o.letter_enc IS NULL OR tpo_role(o.campus_id) IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM cohort_members m WHERE m.user_id = o.user_id AND m.campus_id = o.campus_id AND m.share_level IN ('outcomes', 'full')) THEN
    RETURN NULL;
  END IF;
  IF NOT coalesce((SELECT k.granted FROM consents k WHERE k.user_id = o.user_id AND k.kind = 'offer_letter_tpo' ORDER BY k.at DESC, k.id DESC LIMIT 1), false) THEN
    RETURN NULL;
  END IF;
  INSERT INTO tpo_access_log (campus_id, actor_id, subject_user_id, action) VALUES (o.campus_id, me, o.user_id, 'letter_view');
  RETURN jsonb_build_object('id', o.id, 'userId', o.user_id, 'mime', o.letter_mime, 'letterB64', encode(o.letter_enc, 'base64'));
END
$$;

-- NAAC 5.2.1 rows: offers by students who are verified members at share level outcomes or full. Logged per student.
CREATE FUNCTION tpo_naac_rows(p_campus uuid, p_passout_year integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me    uuid := current_setting('hirelane.user_id')::uuid;
  v_out jsonb;
BEGIN
  IF tpo_role(p_campus) IS NULL THEN RETURN NULL; END IF;
  INSERT INTO tpo_access_log (campus_id, actor_id, subject_user_id, action)
  SELECT p_campus, me, x.user_id, 'naac_export'
    FROM (SELECT DISTINCT o.user_id FROM outcomes o
            JOIN cohort_members m ON m.user_id = o.user_id AND m.campus_id = o.campus_id
            JOIN cohorts c ON c.id = o.cohort_id
           WHERE o.campus_id = p_campus AND o.kind = 'offer' AND m.verified_at IS NOT NULL AND m.share_level IN ('outcomes', 'full')
             AND (p_passout_year IS NULL OR c.passout_year = p_passout_year)) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'year', extract(year FROM o.created_at)::integer, 'student', coalesce(u.display_name, ''), 'programme', c.programme,
           'employer', o.employer, 'packageLpa', o.package_lpa, 'verification', o.verification)
           ORDER BY o.created_at, o.id), '[]'::jsonb)
    INTO v_out
    FROM outcomes o
    JOIN cohort_members m ON m.user_id = o.user_id AND m.campus_id = o.campus_id
    JOIN cohorts c ON c.id = o.cohort_id
    JOIN users u ON u.id = o.user_id
   WHERE o.campus_id = p_campus AND o.kind = 'offer' AND m.verified_at IS NOT NULL AND m.share_level IN ('outcomes', 'full')
     AND (p_passout_year IS NULL OR c.passout_year = p_passout_year);
  RETURN v_out;
END
$$;

-- ---------- TPO: roster, staff ----------
-- p_rows: [{"h": email hmac, "placed": bool}], already de-duplicated and capped by the service.
CREATE FUNCTION tpo_import_roster(p_cohort_id uuid, p_rows jsonb, p_total integer, p_rejected integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campus  uuid := tpo_campus_of_cohort(p_cohort_id);
  v_valid   integer;
  v_matched integer;
BEGIN
  IF v_campus IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 20000 THEN
    RAISE EXCEPTION 'roster rows must be an array of at most 20000' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO cohort_roster (campus_id, cohort_id, email_hmac, placed)
  SELECT DISTINCT ON (r ->> 'h') v_campus, p_cohort_id, r ->> 'h', coalesce((r ->> 'placed')::boolean, false)
    FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (cohort_id, email_hmac) DO UPDATE SET placed = EXCLUDED.placed, imported_at = now();
  v_valid := jsonb_array_length(p_rows);

  -- Members whose proven mailbox is on the roster become verified (roster) and take the placed flag.
  UPDATE cohort_members m
     SET placed = r.placed,
         verified_via = CASE WHEN m.verified_via = 'code' THEN 'roster' ELSE m.verified_via END,
         verified_at = coalesce(m.verified_at, now()),
         updated_at = now()
    FROM cohort_roster r
   WHERE r.cohort_id = p_cohort_id AND m.cohort_id = p_cohort_id AND m.email_hmac = r.email_hmac;
  GET DIAGNOSTICS v_matched = ROW_COUNT;

  INSERT INTO cohort_imports (campus_id, cohort_id, actor_id, rows_total, rows_valid, rows_rejected, matched)
  VALUES (v_campus, p_cohort_id, current_setting('hirelane.user_id')::uuid, p_total, v_valid, p_rejected, v_matched);
  RETURN jsonb_build_object('rowsTotal', p_total, 'rowsValid', v_valid, 'rowsRejected', p_rejected, 'matched', v_matched);
END
$$;

-- Owner only. Status: invited | exists | forbidden
CREATE FUNCTION tpo_invite_staff(p_campus uuid, p_email_hmac text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF tpo_role(p_campus) IS DISTINCT FROM 'owner' THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM tpo_members t WHERE t.campus_id = p_campus AND t.email_hmac = p_email_hmac) THEN
    RETURN jsonb_build_object('status', 'exists');
  END IF;
  INSERT INTO tpo_members (campus_id, email_hmac, role, invited_by) VALUES (p_campus, p_email_hmac, 'staff', current_setting('hirelane.user_id')::uuid);
  RETURN jsonb_build_object('status', 'invited');
END
$$;

CREATE FUNCTION tpo_list_staff(p_campus uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF tpo_role(p_campus) IS DISTINCT FROM 'owner' THEN RETURN NULL; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'role', t.role, 'claimed', t.user_id IS NOT NULL, 'createdAt', t.created_at)
                                    ORDER BY t.created_at, t.id), '[]'::jsonb)
            FROM tpo_members t WHERE t.campus_id = p_campus);
END
$$;

-- ---------- execute rights ----------
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND (p.proname LIKE 'campus\_%' OR p.proname LIKE 'tpo\_%')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  -- Internal helpers (tpo_role, tpo_campus_of_cohort, campus_release_cells) stay unreachable for the app role; the
  -- definer functions above call them as the owner.
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY (ARRAY[
       'campus_join_code', 'campus_email_issue', 'campus_email_spend', 'campus_email_join', 'campus_leave',
       'tpo_claim_invites', 'tpo_memberships', 'tpo_create_cohort', 'tpo_list_cohorts', 'tpo_cohort_stats',
       'tpo_publish_drive', 'tpo_list_drives', 'tpo_drive_counts', 'tpo_list_outcomes', 'tpo_verify_outcome',
       'tpo_outcome_letter', 'tpo_naac_rows', 'tpo_import_roster', 'tpo_invite_staff', 'tpo_list_staff'])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO hirelane_app', f);
  END LOOP;
END
$$;
