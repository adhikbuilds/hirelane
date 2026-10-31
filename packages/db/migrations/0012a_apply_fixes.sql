-- 0012a_apply_fixes: let a deleted job detach from its applications.
-- applications.job_id is ON DELETE SET NULL. Postgres performs that as an UPDATE on applications, and the immutability guard in
-- applications_transition (0012) refused any change to job_id, so deleting a job (or a company, which cascades to its jobs)
-- would have failed once a student had applied to it. job_id may now go to NULL, never to a different job.
CREATE OR REPLACE FUNCTION applications_transition() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  from_s text := OLD.status;
  to_s   text := NEW.status;
  by_app boolean := current_user = 'hirelane_app';
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
  ELSE
    RAISE EXCEPTION 'illegal application transition % -> %', from_s, to_s USING ERRCODE = 'check_violation', CONSTRAINT = 'applications_transition';
  END IF;
  RETURN NEW;
END
$$;
