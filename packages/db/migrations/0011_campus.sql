-- 0011_campus: the campus tables. PLAN Amendment B sections 13 and 15, PRD C1-C7, docs/design/campus-build-plan.md Slice 4.
--
-- Access model (RLS is ENABLE, never FORCE, per 0007; hirelane_app owns nothing):
--   * Students reach their own rows (cohort_members own-r, outcomes own-nd) and read their own campus's shared rows
--     (campuses, campus_domains, cohorts, published drives: the `ten` mode in verify-rls).
--   * Everything else here is revoked from hirelane_app. It is reached only through the SECURITY DEFINER functions in
--     0011a, which take the caller from hirelane.user_id and never from a parameter.
--   * A TPO never reads a table. TPO reads go through 0011a functions over cohort_stats_daily snapshots (k = 10 over
--     VERIFIED members, complementary suppression, counts rounded to 5), or over the outcomes the student chose to share.
--   * Code joins never count toward k: only members with verified_at set (college email OTP or roster match) do.

-- ---------- campuses ----------
CREATE TABLE campuses (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  -- HMAC of the 8-character base32 join code (purpose campus/code). The code itself is never stored.
  code_hmac  text        NOT NULL,
  -- {"kind":"linear","a":..,"b":..}: percentage = a * CGPA + b. Null means no rule, so a CGPA-vs-% criterion is unknown.
  cgpa_rule  jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campuses_name_len CHECK (char_length(name) BETWEEN 2 AND 160),
  CONSTRAINT campuses_code_hmac_len CHECK (char_length(code_hmac) BETWEEN 8 AND 200),
  CONSTRAINT campuses_cgpa_rule_shape CHECK (
    cgpa_rule IS NULL OR (
      jsonb_typeof(cgpa_rule) = 'object'
      AND cgpa_rule ->> 'kind' = 'linear'
      AND jsonb_typeof(cgpa_rule -> 'a') = 'number'
      AND jsonb_typeof(cgpa_rule -> 'b') = 'number'))
);
CREATE UNIQUE INDEX campuses_code_hmac_uq ON campuses (code_hmac);

-- Entered by ops; a domain proves nothing until the student passes the email OTP (purpose campus_email).
CREATE TABLE campus_domains (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id  uuid        NOT NULL REFERENCES campuses (id) ON DELETE CASCADE,
  domain     citext      NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campus_domains_shape CHECK (domain::text ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND char_length(domain::text) <= 120)
);
CREATE UNIQUE INDEX campus_domains_domain_uq ON campus_domains (domain);
CREATE INDEX campus_domains_campus_idx ON campus_domains (campus_id);

CREATE TABLE cohorts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id   uuid        NOT NULL REFERENCES campuses (id) ON DELETE CASCADE,
  passout_year smallint   NOT NULL,
  programme   text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cohorts_year CHECK (passout_year BETWEEN 2000 AND 2100),
  CONSTRAINT cohorts_programme_len CHECK (char_length(programme) BETWEEN 1 AND 80 AND programme = btrim(programme)),
  CONSTRAINT cohorts_id_campus_uq UNIQUE (id, campus_id)
);
CREATE UNIQUE INDEX cohorts_campus_year_programme_uq ON cohorts (campus_id, passout_year, lower(programme));

-- ---------- membership ----------
CREATE TABLE cohort_members (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  campus_id    uuid        NOT NULL,
  cohort_id    uuid        NOT NULL,
  share_level  text        NOT NULL DEFAULT 'aggregate',
  -- code: joined with the campus code, unproven (does not count toward k).
  -- email: proved a college-domain mailbox by OTP. roster: the proven mailbox matches a TPO roster row.
  verified_via text        NOT NULL,
  verified_at  timestamptz,
  -- Keyed hash of the proven mailbox (purpose campus/email, same normalisation as the roster). Null when unproven.
  email_hmac   text,
  -- From the roster. The student can read it (picks drop placed students) but never write it.
  placed       boolean     NOT NULL DEFAULT false,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cohort_members_cohort_fk FOREIGN KEY (cohort_id, campus_id) REFERENCES cohorts (id, campus_id) ON DELETE CASCADE,
  CONSTRAINT cohort_members_share_level CHECK (share_level IN ('aggregate', 'outcomes', 'full')),
  CONSTRAINT cohort_members_verified_via CHECK (verified_via IN ('code', 'email', 'roster')),
  CONSTRAINT cohort_members_verified_consistent CHECK ((verified_via = 'code') = (verified_at IS NULL))
);
-- One seat per person, and one seat per proven mailbox inside a campus.
CREATE UNIQUE INDEX cohort_members_user_uq ON cohort_members (user_id);
CREATE UNIQUE INDEX cohort_members_mailbox_uq ON cohort_members (campus_id, email_hmac) WHERE email_hmac IS NOT NULL;
CREATE INDEX cohort_members_cohort_idx ON cohort_members (cohort_id) WHERE verified_at IS NOT NULL;

-- Roster import (C7): email HMAC and a placed flag only. No names, no roll numbers.
CREATE TABLE cohort_roster (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id   uuid        NOT NULL,
  cohort_id   uuid        NOT NULL,
  email_hmac  text        NOT NULL,
  placed      boolean     NOT NULL DEFAULT false,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cohort_roster_cohort_fk FOREIGN KEY (cohort_id, campus_id) REFERENCES cohorts (id, campus_id) ON DELETE CASCADE,
  CONSTRAINT cohort_roster_uq UNIQUE (cohort_id, email_hmac)
);

-- Counts only. The CSV itself and the plain addresses are never stored.
CREATE TABLE cohort_imports (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id     uuid        NOT NULL,
  cohort_id     uuid        NOT NULL,
  actor_id      uuid        REFERENCES users (id) ON DELETE SET NULL,
  rows_total    integer     NOT NULL,
  rows_valid    integer     NOT NULL,
  rows_rejected integer     NOT NULL,
  matched       integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cohort_imports_cohort_fk FOREIGN KEY (cohort_id, campus_id) REFERENCES cohorts (id, campus_id) ON DELETE CASCADE,
  CONSTRAINT cohort_imports_counts CHECK (rows_total >= 0 AND rows_valid >= 0 AND rows_rejected >= 0 AND matched >= 0)
);
CREATE INDEX cohort_imports_cohort_idx ON cohort_imports (cohort_id, created_at DESC);

-- ---------- staff ----------
-- A staff session needs a row here. An invite stores only the invitee's email HMAC (user_id null); the person claims it
-- the first time they call a TPO route after signing in with that mailbox (email code, the existing auth).
CREATE TABLE tpo_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id  uuid        NOT NULL REFERENCES campuses (id) ON DELETE CASCADE,
  user_id    uuid        REFERENCES users (id) ON DELETE CASCADE,
  email_hmac text        NOT NULL,
  role       text        NOT NULL DEFAULT 'staff',
  invited_by uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  CONSTRAINT tpo_members_role CHECK (role IN ('owner', 'staff')),
  CONSTRAINT tpo_members_claim_consistent CHECK ((user_id IS NULL) = (claimed_at IS NULL))
);
CREATE UNIQUE INDEX tpo_members_campus_email_uq ON tpo_members (campus_id, email_hmac);
CREATE UNIQUE INDEX tpo_members_campus_user_uq ON tpo_members (campus_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX tpo_members_user_idx ON tpo_members (user_id) WHERE user_id IS NOT NULL;

-- Every TPO read of an individual student (outcome list, NAAC export, letter view) and every verification, one row per
-- student. The student reads the rows where they are the subject (Amendment B section 15: visible to that student).
CREATE TABLE tpo_access_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id       uuid        NOT NULL REFERENCES campuses (id) ON DELETE CASCADE,
  actor_id        uuid        REFERENCES users (id) ON DELETE SET NULL,
  subject_user_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action          text        NOT NULL,
  at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tpo_access_log_action CHECK (action IN ('outcomes_list', 'outcome_verify', 'naac_export', 'letter_view'))
);
CREATE INDEX tpo_access_log_subject_idx ON tpo_access_log (subject_user_id, at DESC);

-- Counts attempts to join (code lookup, mail send, code check) for rate limiting. Written only by definer functions.
CREATE TABLE join_attempts (
  id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    text        NOT NULL,
  ip_hash text,
  ok      boolean     NOT NULL DEFAULT false,
  at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT join_attempts_kind CHECK (kind IN ('code', 'email_send', 'email_verify'))
);
CREATE INDEX join_attempts_user_idx ON join_attempts (user_id, kind, at DESC);
CREATE INDEX join_attempts_ip_idx ON join_attempts (ip_hash, kind, at DESC) WHERE ip_hash IS NOT NULL;
CREATE INDEX join_attempts_at_idx ON join_attempts (at);

-- Binds a campus_email OTP challenge to the campus whose domain it was issued for, so the join reads the campus from here
-- and not from a caller argument.
CREATE TABLE campus_otp_bindings (
  challenge_id uuid PRIMARY KEY REFERENCES otp_challenges (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  campus_id    uuid NOT NULL REFERENCES campuses (id) ON DELETE CASCADE
);

-- ---------- drives (C4) ----------
-- The TPO pastes a notice (and optionally a link, which is never fetched). Criteria come from parseCriteria, flags from
-- detectScamSignals. A drive goes to a cohort; each student sees it unless their own profile fails a criterion.
CREATE TABLE drives (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id    uuid        NOT NULL,
  cohort_id    uuid        NOT NULL,
  title        text        NOT NULL,
  link         text,
  notice_text  text        NOT NULL,
  criteria     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  scam_flags   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  scam_risk    text        NOT NULL DEFAULT 'none',
  status       text        NOT NULL DEFAULT 'published',
  created_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drives_cohort_fk FOREIGN KEY (cohort_id, campus_id) REFERENCES cohorts (id, campus_id) ON DELETE CASCADE,
  CONSTRAINT drives_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT drives_link_len CHECK (link IS NULL OR char_length(link) BETWEEN 1 AND 500),
  CONSTRAINT drives_notice_len CHECK (char_length(notice_text) BETWEEN 1 AND 20000),
  CONSTRAINT drives_criteria_array CHECK (jsonb_typeof(criteria) = 'array'),
  CONSTRAINT drives_flags_array CHECK (jsonb_typeof(scam_flags) = 'array'),
  CONSTRAINT drives_scam_risk CHECK (scam_risk IN ('none', 'low', 'medium', 'high')),
  CONSTRAINT drives_status CHECK (status IN ('published', 'closed'))
);
CREATE INDEX drives_cohort_idx ON drives (cohort_id, published_at DESC);

-- The nightly worker's verdict per member. The student reads their own; counts reach a TPO only as k-suppressed snapshots.
CREATE TABLE drive_checks (
  drive_id   uuid        NOT NULL REFERENCES drives (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  verdict    text        NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (drive_id, user_id),
  CONSTRAINT drive_checks_verdict CHECK (verdict IN ('eligible', 'unknown', 'ineligible'))
);
CREATE INDEX drive_checks_user_idx ON drive_checks (user_id);

-- ---------- outcomes (C5) ----------
CREATE TABLE outcomes (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  campus_id    uuid         NOT NULL,
  cohort_id    uuid         NOT NULL,
  kind         text         NOT NULL,
  employer     text         NOT NULL,
  role_title   text,
  package_lpa  numeric(7,2),
  -- Sealed (vault envelope, AAD outcome-letter:<user>:<id>). Lives in the row so account deletion erases it with the user.
  letter_enc   bytea,
  letter_mime  text,
  verification text         NOT NULL DEFAULT 'student_reported',
  verified_by  uuid         REFERENCES users (id) ON DELETE SET NULL,
  verified_at  timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT outcomes_cohort_fk FOREIGN KEY (cohort_id, campus_id) REFERENCES cohorts (id, campus_id) ON DELETE CASCADE,
  CONSTRAINT outcomes_kind CHECK (kind IN ('interview', 'offer')),
  CONSTRAINT outcomes_employer_len CHECK (char_length(employer) BETWEEN 1 AND 160),
  CONSTRAINT outcomes_role_len CHECK (role_title IS NULL OR char_length(role_title) BETWEEN 1 AND 120),
  CONSTRAINT outcomes_package CHECK (package_lpa IS NULL OR package_lpa BETWEEN 0 AND 1000),
  CONSTRAINT outcomes_letter_mime CHECK (letter_mime IS NULL OR letter_mime = 'application/pdf'),
  CONSTRAINT outcomes_letter_pair CHECK ((letter_enc IS NULL) = (letter_mime IS NULL)),
  CONSTRAINT outcomes_verification CHECK (verification IN ('student_reported', 'tpo_verified')),
  CONSTRAINT outcomes_verified_consistent CHECK ((verification = 'tpo_verified') = (verified_at IS NOT NULL))
);
CREATE INDEX outcomes_user_idx ON outcomes (user_id, created_at DESC);
CREATE INDEX outcomes_cohort_idx ON outcomes (cohort_id, kind);

-- ---------- nightly snapshots ----------
-- One row per cohort, day and fixed metric: n members with the attribute out of p in the population. Raw counts, so the
-- table is revoked from the app role; suppression and rounding happen in the 0011a read functions.
CREATE TABLE cohort_stats_daily (
  cohort_id uuid    NOT NULL REFERENCES cohorts (id) ON DELETE CASCADE,
  day       date    NOT NULL,
  metric    text    NOT NULL,
  n         integer NOT NULL,
  p         integer NOT NULL,
  PRIMARY KEY (cohort_id, day, metric),
  CONSTRAINT cohort_stats_daily_counts CHECK (n >= 0 AND p >= 0 AND n <= p),
  CONSTRAINT cohort_stats_daily_metric CHECK (metric ~ '^[a-z0-9_]{1,40}(:[0-9a-f-]{36})?$')
);

-- ---------- row level security and grants ----------
-- Student-readable, scoped by membership.
ALTER TABLE campuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY campuses_member_sel ON campuses FOR SELECT TO hirelane_app
  USING (id IN (SELECT m.campus_id FROM cohort_members m WHERE m.user_id = current_setting('hirelane.user_id')::uuid));
REVOKE ALL ON campuses FROM hirelane_app;
GRANT SELECT (id, name, cgpa_rule, created_at) ON campuses TO hirelane_app;

ALTER TABLE campus_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY campus_domains_member_sel ON campus_domains FOR SELECT TO hirelane_app
  USING (campus_id IN (SELECT m.campus_id FROM cohort_members m WHERE m.user_id = current_setting('hirelane.user_id')::uuid));
REVOKE ALL ON campus_domains FROM hirelane_app;
GRANT SELECT ON campus_domains TO hirelane_app;

ALTER TABLE cohorts ENABLE ROW LEVEL SECURITY;
CREATE POLICY cohorts_member_sel ON cohorts FOR SELECT TO hirelane_app
  USING (campus_id IN (SELECT m.campus_id FROM cohort_members m WHERE m.user_id = current_setting('hirelane.user_id')::uuid));
REVOKE ALL ON cohorts FROM hirelane_app;
GRANT SELECT ON cohorts TO hirelane_app;

-- own-r: read and update own row. The only writable column is the share level; verified_via, verified_at, cohort,
-- campus, placed and the mailbox hash are not grantable, so a student cannot verify themselves or inflate k.
ALTER TABLE cohort_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY cohort_members_own_sel ON cohort_members FOR SELECT TO hirelane_app USING (user_id = current_setting('hirelane.user_id')::uuid);
CREATE POLICY cohort_members_own_upd ON cohort_members FOR UPDATE TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON cohort_members FROM hirelane_app;
GRANT SELECT ON cohort_members TO hirelane_app;
GRANT UPDATE (share_level, updated_at) ON cohort_members TO hirelane_app;

ALTER TABLE drives ENABLE ROW LEVEL SECURITY;
CREATE POLICY drives_cohort_sel ON drives FOR SELECT TO hirelane_app
  USING (status = 'published'
     AND cohort_id IN (SELECT m.cohort_id FROM cohort_members m WHERE m.user_id = current_setting('hirelane.user_id')::uuid));
REVOKE ALL ON drives FROM hirelane_app;
GRANT SELECT ON drives TO hirelane_app;

ALTER TABLE drive_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY drive_checks_own_sel ON drive_checks FOR SELECT TO hirelane_app USING (user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON drive_checks FROM hirelane_app;
GRANT SELECT ON drive_checks TO hirelane_app;

ALTER TABLE tpo_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tpo_access_log_subject_sel ON tpo_access_log FOR SELECT TO hirelane_app USING (subject_user_id = current_setting('hirelane.user_id')::uuid);
REVOKE ALL ON tpo_access_log FROM hirelane_app;
GRANT SELECT (id, campus_id, action, at, subject_user_id) ON tpo_access_log TO hirelane_app;

-- own-nd: a student reports, edits (until the TPO verifies) and reads their own outcomes. They cannot delete (the owner
-- role does, with the account) and cannot touch verification. A report must sit in the student's own campus and cohort.
ALTER TABLE outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY outcomes_own_sel ON outcomes FOR SELECT TO hirelane_app USING (user_id = current_setting('hirelane.user_id')::uuid);
CREATE POLICY outcomes_own_ins ON outcomes FOR INSERT TO hirelane_app
  WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid
          AND EXISTS (SELECT 1 FROM cohort_members m
                       WHERE m.user_id = current_setting('hirelane.user_id')::uuid AND m.campus_id = outcomes.campus_id AND m.cohort_id = outcomes.cohort_id));
CREATE POLICY outcomes_own_upd ON outcomes FOR UPDATE TO hirelane_app
  USING (user_id = current_setting('hirelane.user_id')::uuid AND verification = 'student_reported')
  WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid AND verification = 'student_reported');
REVOKE ALL ON outcomes FROM hirelane_app;
GRANT SELECT ON outcomes TO hirelane_app;
GRANT INSERT (id, user_id, campus_id, cohort_id, kind, employer, role_title, package_lpa) ON outcomes TO hirelane_app;
GRANT UPDATE (employer, role_title, package_lpa, letter_enc, letter_mime, updated_at) ON outcomes TO hirelane_app;

-- Revoked from the app role entirely; RLS is on with no policy as a second lock.
ALTER TABLE cohort_roster ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tpo_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_otp_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_stats_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cohort_roster, cohort_imports, tpo_members, join_attempts, campus_otp_bindings, cohort_stats_daily FROM hirelane_app;
