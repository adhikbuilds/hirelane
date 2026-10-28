-- 0007_rls_posture: how row level security works in Hirelane, and the role plumbing it needs.
--
-- Decided 2026-10-28 (owner):
--   * User tables use ENABLE ROW LEVEL SECURITY, NOT FORCE. The table owner (the migration/admin
--     role) therefore bypasses policies. Policies bind the unprivileged role `hirelane_app` only.
--   * Request code reaches user data through withUser(), which does SET LOCAL ROLE hirelane_app and
--     sets hirelane.user_id. withAdmin() runs as the owner, so it is restricted to an allowlist of
--     callers by scripts/withadmin-guard.ts (part of `pnpm verify`).
--   * `hirelane_app` owns nothing: no tables, no schemas, no CREATE on public. Every object is owned by
--     the migration role, and `hirelane_app` only receives explicit GRANTs. `pnpm db:verify-rls`
--     fails if that stops being true.
--   * Policy pattern for a user table (later migrations):
--       ALTER TABLE t ENABLE ROW LEVEL SECURITY;
--       CREATE POLICY t_own ON t FOR ALL TO hirelane_app
--         USING (user_id = current_setting('hirelane.user_id')::uuid)
--         WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
--     current_setting() is read without missing_ok on purpose: no user context means an error, not a row.

-- SET ROLE hirelane_app only works for a member of the role. A superuser is always allowed; a
-- non-superuser owner (staging, production) needs the membership, so grant it where it is missing.
DO $$
DECLARE
  me oid := (SELECT oid FROM pg_roles WHERE rolname = current_user);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members WHERE roleid = 'hirelane_app'::regrole AND member = me
  ) THEN
    EXECUTE format('GRANT hirelane_app TO %I', current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'could not GRANT hirelane_app TO %; a role administrator must run it before withUser() can SET ROLE', current_user;
END
$$;

REVOKE CREATE ON SCHEMA public FROM hirelane_app;

-- hirelane_app must stay unprivileged and own nothing. Fail the migration rather than ship a silent hole.
DO $$
DECLARE
  r record;
  owned integer;
BEGIN
  SELECT rolsuper, rolbypassrls INTO r FROM pg_roles WHERE rolname = 'hirelane_app';
  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE EXCEPTION 'hirelane_app must not be SUPERUSER or BYPASSRLS';
  END IF;
  SELECT (SELECT count(*) FROM pg_class WHERE relowner = 'hirelane_app'::regrole)
       + (SELECT count(*) FROM pg_namespace WHERE nspowner = 'hirelane_app'::regrole)
       + (SELECT count(*) FROM pg_proc WHERE proowner = 'hirelane_app'::regrole)
    INTO owned;
  IF owned > 0 THEN
    RAISE EXCEPTION 'hirelane_app owns % object(s); it must own nothing', owned;
  END IF;
END
$$;
