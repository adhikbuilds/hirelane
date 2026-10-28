-- 0008_auth: accounts. Amendment B section 9 and 13.
--   * Google OIDC plus a 6-digit email code. Phone OTP: the columns and provider ship now, sending later.
--   * 18+ gate (DPDP s.9): no users row without an age_18_plus consent, enforced by a deferred constraint
--     trigger, so "0 users without consent" is a database guarantee and not an application habit.
--   * RLS follows 0007: ENABLE (never FORCE). hirelane_app is bound by policies and owns nothing.
--     sessions, otp_challenges and auth_identities are revoked from hirelane_app (and carry RLS with no policy,
--     as a second lock). Lookups on them run as the owner through withAdmin, from apps/web/lib/auth only.

CREATE TABLE users (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext      NOT NULL,
  email_verified_at timestamptz,
  display_name      text,
  phone_hmac        text,
  phone_enc         bytea,
  reply_handle      text,
  role              text        NOT NULL DEFAULT 'student',
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_len CHECK (char_length(email::text) BETWEEN 3 AND 254),
  CONSTRAINT users_role_known CHECK (role IN ('student', 'tpo', 'admin')),
  CONSTRAINT users_name_len CHECK (display_name IS NULL OR char_length(display_name) <= 120)
);
CREATE UNIQUE INDEX users_email_uq ON users (email);
CREATE UNIQUE INDEX users_phone_hmac_uq ON users (phone_hmac) WHERE phone_hmac IS NOT NULL;
CREATE UNIQUE INDEX users_reply_handle_uq ON users (reply_handle) WHERE reply_handle IS NOT NULL;

CREATE TABLE auth_identities (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider    text        NOT NULL,
  subject     text        NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_identities_provider CHECK (provider IN ('google', 'email_otp', 'phone_otp')),
  CONSTRAINT auth_identities_provider_subject_uq UNIQUE (provider, subject)
);
CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

CREATE TABLE sessions (
  id_hash             text        PRIMARY KEY,
  user_id             uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client              text        NOT NULL DEFAULT 'web',
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz,
  ua_hash             text,
  CONSTRAINT sessions_client CHECK (client IN ('web', 'android'))
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE otp_challenges (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel     text        NOT NULL,
  purpose     text        NOT NULL DEFAULT 'login',
  target_hmac text        NOT NULL,
  code_hash   text        NOT NULL,
  attempts    smallint    NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  ip_hash     text,
  user_id     uuid        REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_channel CHECK (channel IN ('email', 'sms')),
  CONSTRAINT otp_purpose CHECK (purpose IN ('login', 'campus_email')),
  CONSTRAINT otp_attempts CHECK (attempts BETWEEN 0 AND 5)
);
CREATE INDEX otp_challenges_target_idx ON otp_challenges (target_hmac, created_at DESC);
CREATE INDEX otp_challenges_user_idx ON otp_challenges (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE consents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind        text        NOT NULL,
  granted     boolean     NOT NULL,
  doc_version text        NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consents_kind CHECK (kind IN (
    'age_18_plus', 'terms', 'privacy', 'campus_share', 'offer_letter_tpo',
    'llm_resume', 'llm_contacts', 'whatsapp', 'email_picks', 'analytics'))
);
CREATE INDEX consents_user_kind_idx ON consents (user_id, kind, at DESC);

CREATE TABLE product_events (
  id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event   text        NOT NULL,
  props   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_events_event_len CHECK (char_length(event) BETWEEN 1 AND 64),
  CONSTRAINT product_events_props_object CHECK (jsonb_typeof(props) = 'object'),
  CONSTRAINT product_events_no_pii CHECK (NOT (props ?| ARRAY['email', 'phone', 'name', 'dob', 'aadhaar', 'pan', 'address']))
);
CREATE INDEX product_events_event_at_idx ON product_events (event, at);
CREATE INDEX product_events_user_at_idx ON product_events (user_id, at);

CREATE TABLE idempotency_keys (
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key        text        NOT NULL,
  response   jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key),
  CONSTRAINT idempotency_key_len CHECK (char_length(key) BETWEEN 1 AND 200)
);

-- 18+ gate as a database guarantee. Checked at COMMIT, so the user and the consent go in together.
CREATE FUNCTION users_require_age_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM consents WHERE user_id = NEW.id AND kind = 'age_18_plus' AND granted
  ) THEN
    RAISE EXCEPTION 'users row % has no age_18_plus consent', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER users_age_consent AFTER INSERT ON users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION users_require_age_consent();

-- Row level security. ENABLE, not FORCE (0007).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_own_sel ON users FOR SELECT TO hirelane_app USING (id = current_setting('hirelane.user_id')::uuid);
CREATE POLICY users_own_upd ON users FOR UPDATE TO hirelane_app
  USING (id = current_setting('hirelane.user_id')::uuid) WITH CHECK (id = current_setting('hirelane.user_id')::uuid);
-- Users are created and deleted by the owner role only (sign-up after the 18+ gate, account delete).
-- Column grant: the app role can edit a display name, never role, email or phone columns.
REVOKE ALL ON users FROM hirelane_app;
GRANT SELECT ON users TO hirelane_app;
GRANT UPDATE (display_name) ON users TO hirelane_app;

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY consents_own_sel ON consents FOR SELECT TO hirelane_app USING (user_id = current_setting('hirelane.user_id')::uuid);
CREATE POLICY consents_own_ins ON consents FOR INSERT TO hirelane_app WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON consents FROM hirelane_app;
GRANT SELECT, INSERT ON consents TO hirelane_app;

ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_events_own_sel ON product_events FOR SELECT TO hirelane_app USING (user_id = current_setting('hirelane.user_id')::uuid);
CREATE POLICY product_events_own_ins ON product_events FOR INSERT TO hirelane_app WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON product_events FROM hirelane_app;
GRANT SELECT, INSERT ON product_events TO hirelane_app;

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_keys_own ON idempotency_keys FOR ALL TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON idempotency_keys FROM hirelane_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO hirelane_app;

-- Revoked from the app role; RLS is on with no policy as a second lock.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sessions, otp_challenges, auth_identities FROM hirelane_app;

-- Flag stays off until the grievance officer is named. The dev seed and e2e turn it on.
INSERT INTO feature_flags (key, enabled, user_id) VALUES ('accounts', false, NULL)
  ON CONFLICT DO NOTHING;
