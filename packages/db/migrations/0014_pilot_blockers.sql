-- 0014_pilot_blockers: the database side of the pilot blockers in docs/apply.md "Open before pilot"
-- (0013 / 0013a / 0013b are applied and checksum-locked).
--
--   1. application_answers.suggestion_enc: the draft of a free-text answer the engine composed from a template. Such an answer is
--      NEVER sent unseen; it is stored as needs_you, with the draft sealed here so the student can confirm or edit it.
--      A suggestion exists only on a needs_you row.
--   2. Reads that do not write. Until now every TPO GET claimed invites, and the outcome list, the letter view and the NAAC
--      export wrote tpo_access_log rows. Now:
--        tpo_peek_outcomes   STABLE, no log row, student names and emails withheld (the GET view)
--        tpo_naac_count      STABLE, no log row, a count only (the GET preview)
--        tpo_has_pending_invite STABLE, answers "is there an invite for my verified mailbox" without claiming it
--      The functions that DISCLOSE a student (tpo_list_outcomes, tpo_naac_rows, tpo_outcome_letter) keep writing the access log,
--      and the web layer only calls them from explicit POST actions. So the student's log still has one row per disclosure,
--      and a GET can no longer disclose a student without the log.
--   3. Roster import and drive publishing need a WRITE role on the campus: owner or officer. The officer seat is the stored role
--      'staff'. There is no viewer role (the CHECK on tpo_members.role forbids one) and the gate fails closed for any role
--      that is not named here.
--   4. ops_audit: one row per operator command (campus create, domain add / remove, cgpa_rule, owner invite, platform switch).

-- ---------- 1. draft suggestions ----------
ALTER TABLE application_answers ADD COLUMN suggestion_enc bytea;
ALTER TABLE application_answers ADD CONSTRAINT application_answers_suggestion_needs_you CHECK (suggestion_enc IS NULL OR needs_you);

-- ---------- 3. the write gate ----------
-- True for a claimed owner or officer of the campus. NULL role (not staff here) and any other role are false.
CREATE FUNCTION tpo_can_write(p_campus uuid) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(tpo_role(p_campus) IN ('owner', 'staff'), false)
$$;
REVOKE ALL ON FUNCTION tpo_can_write(uuid) FROM PUBLIC;

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
  IF NOT tpo_can_write(v_campus) THEN
    RAISE EXCEPTION 'tpo_write_role_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
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

CREATE OR REPLACE FUNCTION tpo_publish_drive(p_cohort_id uuid, p_title text, p_link text, p_notice text, p_criteria jsonb, p_flags jsonb, p_risk text) RETURNS uuid
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

-- ---------- 2. reads that do not write ----------
-- The GET view of the outcome list: the same rows, no log row, and the student's name and email withheld. Because no student is
-- identified to the TPO here, nothing is owed to the student's access log. The identified list is tpo_list_outcomes (logged).
CREATE FUNCTION tpo_peek_outcomes(p_campus uuid, p_cohort_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF tpo_role(p_campus) IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'kind', o.kind, 'employer', o.employer, 'roleTitle', o.role_title, 'packageLpa', o.package_lpa,
           'verification', o.verification, 'createdAt', o.created_at, 'verifiedAt', o.verified_at,
           'studentName', NULL, 'studentEmail', NULL,
           'memberVerified', m.verified_at IS NOT NULL,
           'programme', c.programme, 'passoutYear', c.passout_year, 'cohortId', o.cohort_id,
           'hasLetter', o.letter_enc IS NOT NULL
                        AND coalesce((SELECT k.granted FROM consents k WHERE k.user_id = o.user_id AND k.kind = 'offer_letter_tpo'
                                       ORDER BY k.at DESC, k.id DESC LIMIT 1), false))
           ORDER BY o.created_at DESC), '[]'::jsonb)
    INTO v_out
    FROM outcomes o
    JOIN cohort_members m ON m.user_id = o.user_id AND m.campus_id = o.campus_id
    JOIN cohorts c ON c.id = o.cohort_id
   WHERE o.campus_id = p_campus AND m.share_level IN ('outcomes', 'full') AND (p_cohort_id IS NULL OR o.cohort_id = p_cohort_id);
  RETURN v_out;
END
$$;

-- The GET preview of the NAAC export: how many rows the export would hold. No names, no log row.
CREATE FUNCTION tpo_naac_count(p_campus uuid, p_passout_year integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF tpo_role(p_campus) IS NULL THEN RETURN NULL; END IF;
  SELECT count(*)::integer INTO v_n
    FROM outcomes o
    JOIN cohort_members m ON m.user_id = o.user_id AND m.campus_id = o.campus_id
    JOIN cohorts c ON c.id = o.cohort_id
   WHERE o.campus_id = p_campus AND o.kind = 'offer' AND m.verified_at IS NOT NULL AND m.share_level IN ('outcomes', 'full')
     AND (p_passout_year IS NULL OR c.passout_year = p_passout_year);
  RETURN jsonb_build_object('rows', v_n);
END
$$;

-- Is there an unexpired, unclaimed invite for this (verified) mailbox? Same test as tpo_claim_invites, without the update.
CREATE FUNCTION tpo_has_pending_invite(p_email_hmac text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tpo_members t
     WHERE t.user_id IS NULL AND t.email_hmac = p_email_hmac AND t.expires_at > now()
       AND EXISTS (SELECT 1 FROM users u WHERE u.id = current_setting('hirelane.user_id')::uuid AND u.email_verified_at IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM tpo_members x WHERE x.campus_id = t.campus_id AND x.user_id = current_setting('hirelane.user_id')::uuid))
$$;

REVOKE ALL ON FUNCTION tpo_peek_outcomes(uuid, uuid), tpo_naac_count(uuid, integer), tpo_has_pending_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tpo_peek_outcomes(uuid, uuid), tpo_naac_count(uuid, integer), tpo_has_pending_invite(text) TO hirelane_app;

-- ---------- 4. operator audit ----------
-- Written by the ops CLI (packages/db/src/ops) as the owner role, in the same transaction as the change it records.
-- No personal data: ids, names of campuses and domains, and counts. An invite is recorded by member id, never by address.
CREATE TABLE ops_audit (
  id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  at      timestamptz NOT NULL DEFAULT now(),
  actor   text        NOT NULL,
  command text        NOT NULL,
  target  text,
  detail  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ops_audit_command CHECK (command IN ('campus_create', 'domain_add', 'domain_remove', 'cgpa_rule_set', 'owner_invite', 'platform_switch')),
  CONSTRAINT ops_audit_actor_len CHECK (char_length(actor) BETWEEN 1 AND 120),
  CONSTRAINT ops_audit_target_len CHECK (target IS NULL OR char_length(target) <= 200)
);
CREATE INDEX ops_audit_at_idx ON ops_audit (at DESC);
REVOKE ALL ON ops_audit FROM PUBLIC, hirelane_app;
