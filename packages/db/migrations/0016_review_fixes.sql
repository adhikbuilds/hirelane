-- 0016: fixes from the PR review.
--  1. resumes: the app role may not undo worker-only invariants (un-delete, move the purge, change parse_status).
--     The blob_key prefix on INSERT stays with the service (blobKeyFor); the app role cannot UPDATE blob_key.
--  2. erase_waitlist: account erasure also removes the plain-email waitlist row.

CREATE FUNCTION resumes_app_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user <> 'hirelane_app' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.parse_status IS DISTINCT FROM OLD.parse_status OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION 'parse_status and confirmed_at are written by the worker or a version insert' USING ERRCODE = 'check_violation', CONSTRAINT = 'resumes_app_status';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.purge_after IS DISTINCT FROM OLD.purge_after) THEN
    RAISE EXCEPTION 'a deleted resume cannot be restored or have its purge moved' USING ERRCODE = 'check_violation', CONSTRAINT = 'resumes_app_deleted';
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND NEW.purge_after IS DISTINCT FROM NEW.deleted_at THEN
    RAISE EXCEPTION 'purge_after must equal deleted_at' USING ERRCODE = 'check_violation', CONSTRAINT = 'resumes_app_deleted';
  END IF;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL AND NEW.purge_after IS DISTINCT FROM OLD.purge_after THEN
    RAISE EXCEPTION 'purge_after is set only by deleting' USING ERRCODE = 'check_violation', CONSTRAINT = 'resumes_app_deleted';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER resumes_app_guard BEFORE INSERT OR UPDATE ON resumes FOR EACH ROW EXECUTE FUNCTION resumes_app_guard();

CREATE FUNCTION erase_waitlist(p_user uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM waitlist WHERE lower(email) = (SELECT lower(email) FROM users WHERE id = p_user);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION erase_waitlist(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_waitlist(uuid) TO hirelane_auth;
