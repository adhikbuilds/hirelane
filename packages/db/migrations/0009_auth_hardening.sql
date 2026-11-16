-- 0009_auth_hardening: findings from the Slice 1/2 security review.
--   * hirelane_auth: a narrow role for apps/web/lib/auth, replacing the table-owner connection. It can touch only the
--     auth tables, cannot bypass RLS (it has explicit policies), cannot change a user's role or email, and owns nothing.
--   * consents: the app role can no longer write an age_18_plus consent or choose the timestamp. Sign-up (hirelane_auth)
--     is the only writer of age_18_plus, and it always stamps server time.
--   * product_events: the PII key check is now recursive and case-insensitive.

-- ---------- hirelane_auth ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hirelane_auth') THEN
    CREATE ROLE hirelane_auth NOLOGIN;
  END IF;
END
$$;

DO $$
DECLARE
  me oid := (SELECT oid FROM pg_roles WHERE rolname = current_user);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members WHERE roleid = 'hirelane_auth'::regrole AND member = me
  ) THEN
    EXECUTE format('GRANT hirelane_auth TO %I', current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'could not GRANT hirelane_auth TO %; a role administrator must run it before withAuth() can SET ROLE', current_user;
END
$$;

GRANT USAGE ON SCHEMA public TO hirelane_auth;
REVOKE CREATE ON SCHEMA public FROM hirelane_auth;

GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, otp_challenges, auth_identities TO hirelane_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO hirelane_auth;
GRANT SELECT ON feature_flags TO hirelane_auth;
-- Users: create (id, email, verified), read, mark verified, delete. Never role, phone or name.
GRANT SELECT, DELETE ON users TO hirelane_auth;
GRANT INSERT (id, email, email_verified_at) ON users TO hirelane_auth;
GRANT UPDATE (email_verified_at) ON users TO hirelane_auth;
GRANT SELECT ON consents TO hirelane_auth;
GRANT INSERT (user_id, kind, granted, doc_version) ON consents TO hirelane_auth;

-- RLS stays ENABLE (not FORCE). hirelane_auth is not the owner and has no BYPASSRLS, so it needs explicit policies.
CREATE POLICY sessions_auth ON sessions FOR ALL TO hirelane_auth USING (true) WITH CHECK (true);
CREATE POLICY otp_challenges_auth ON otp_challenges FOR ALL TO hirelane_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_identities_auth ON auth_identities FOR ALL TO hirelane_auth USING (true) WITH CHECK (true);
CREATE POLICY users_auth ON users FOR ALL TO hirelane_auth USING (true) WITH CHECK (true);
CREATE POLICY consents_auth_sel ON consents FOR SELECT TO hirelane_auth USING (true);
CREATE POLICY consents_auth_ins ON consents FOR INSERT TO hirelane_auth WITH CHECK (true);

DO $$
DECLARE
  r record;
  owned int;
BEGIN
  SELECT rolsuper, rolbypassrls INTO r FROM pg_roles WHERE rolname = 'hirelane_auth';
  IF r.rolsuper OR r.rolbypassrls THEN
    RAISE EXCEPTION 'hirelane_auth must not be SUPERUSER or BYPASSRLS';
  END IF;
  SELECT (SELECT count(*) FROM pg_class WHERE relowner = 'hirelane_auth'::regrole)
       + (SELECT count(*) FROM pg_namespace WHERE nspowner = 'hirelane_auth'::regrole)
       + (SELECT count(*) FROM pg_proc WHERE proowner = 'hirelane_auth'::regrole) INTO owned;
  IF owned > 0 THEN
    RAISE EXCEPTION 'hirelane_auth owns % object(s); it must own nothing', owned;
  END IF;
END
$$;

-- ---------- consents: no forged age attestation, no back-dating ----------
DROP POLICY consents_own_ins ON consents;
CREATE POLICY consents_own_ins ON consents FOR INSERT TO hirelane_app
  WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid AND kind <> 'age_18_plus');
REVOKE INSERT ON consents FROM hirelane_app;
GRANT INSERT (user_id, kind, granted, doc_version) ON consents TO hirelane_app;

-- ---------- product_events: recursive, case-insensitive PII key check ----------
CREATE FUNCTION props_has_pii_key(j jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  k text;
  v jsonb;
BEGIN
  IF jsonb_typeof(j) = 'object' THEN
    FOR k, v IN SELECT * FROM jsonb_each(j) LOOP
      IF lower(k) = ANY (ARRAY['email', 'phone', 'name', 'dob', 'aadhaar', 'pan', 'address']) OR props_has_pii_key(v) THEN
        RETURN true;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(j) = 'array' THEN
    FOR v IN SELECT * FROM jsonb_array_elements(j) LOOP
      IF props_has_pii_key(v) THEN
        RETURN true;
      END IF;
    END LOOP;
  END IF;
  RETURN false;
END
$$;
ALTER TABLE product_events DROP CONSTRAINT product_events_no_pii;
ALTER TABLE product_events ADD CONSTRAINT product_events_no_pii CHECK (NOT props_has_pii_key(props));
