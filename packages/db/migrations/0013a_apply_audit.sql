-- 0013a_apply_audit: findings from the review of the apply pipeline (0012 / 0012a are applied and checksum-locked).
--
--   1. "Who is the app?" was `current_user = 'hirelane_app'`. A login role that is a member of hirelane_app without SET ROLE would
--      have been treated as the worker and allowed ready -> submitting -> submitted. Now only the table owner (or a superuser,
--      the migration / test role) is the worker; every other role is treated as the app, so the check fails closed.
--   2. "Needs you" was a dead end. New moves:
--        blocked_fallback (reason needs_you) -> ready       the student answered the question; a fresh 4 second window
--        blocked_fallback                    -> submitted   the student finished on the employer's site (manual_finish = true)
--        submitting                          -> ready       the worker puts an over-cap application back for the next local day
--      The earlier receipt and answers of a blocked attempt are replaced by the worker when the next attempt finishes.
ALTER TABLE applications ADD COLUMN manual_finish boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION applications_transition() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  from_s text := OLD.status;
  to_s   text := NEW.status;
  by_app boolean := NOT (
    current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID)
    OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND r.rolsuper));
BEGIN
  IF NEW.user_id <> OLD.user_id OR (NEW.job_id IS DISTINCT FROM OLD.job_id AND NEW.job_id IS NOT NULL) OR NEW.platform <> OLD.platform OR NEW.apply_url <> OLD.apply_url THEN
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
  ELSIF from_s = 'submitting' AND to_s = 'ready' AND NOT by_app THEN
    NEW.claimed_at := NULL;
    NEW.undo_until := now();
  ELSIF from_s = 'blocked_fallback' AND to_s = 'ready' AND OLD.blocked_reason = 'needs_you' THEN
    NEW.undo_until := now() + interval '4 seconds';
    NEW.claimed_at := NULL;
    NEW.blocked_reason := NULL;
    NEW.fallback_note := NULL;
  ELSIF from_s = 'blocked_fallback' AND to_s = 'submitted' AND by_app THEN
    NEW.submitted_at := now();
    NEW.manual_finish := true;
    NEW.blocked_reason := NULL;
    NEW.fallback_note := NULL;
  ELSE
    RAISE EXCEPTION 'illegal application transition % -> %', from_s, to_s USING ERRCODE = 'check_violation', CONSTRAINT = 'applications_transition';
  END IF;
  RETURN NEW;
END
$$;
