-- 0006: early-access waitlist (audit UX-1). Contact details only, never a resume.
CREATE TABLE waitlist (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text        NOT NULL,
  grad_year  smallint,
  source     text        NOT NULL DEFAULT 'landing',
  consent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_email_len CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT waitlist_grad_year_range CHECK (grad_year IS NULL OR grad_year BETWEEN 2015 AND 2035),
  CONSTRAINT waitlist_source_len CHECK (char_length(source) <= 32)
);
-- One row per address, case-insensitive. Re-joining is a no-op.
CREATE UNIQUE INDEX waitlist_email_uq ON waitlist (lower(email));

-- The app role may add itself to the list; it never reads it back.
GRANT INSERT ON waitlist TO hirelane_app;
