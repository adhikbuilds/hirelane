-- 0018: where every job came from (source_kind / source_label / source_url) and two new board kinds (jsonld, zoho_rss).
--
--  * company_boards.ats widens to the JSON-LD career-site and Zoho Recruit RSS sources approved on 2026-10-29.
--  * jobs gets source_kind, source_label, source_url. source_url is the ORIGINAL posting (https), never the apply form.
--  * Existing jobs are backfilled from their primary posting's board; a trigger derives the same values for every
--    new job, so the enrichment writer needs no change. A job with no resolvable posting keeps NULLs (all three or none).
--  * user_shared is for links a student or placement officer pastes: only the URL and a platform label are stored and the
--    page behind it is never fetched. The label is constrained to the fixed set below.
--  * campus_drive is reserved for drive-backed jobs; the trigger never overwrites user_shared or campus_drive.

ALTER TABLE company_boards DROP CONSTRAINT company_boards_ats_check;
ALTER TABLE company_boards ADD CONSTRAINT company_boards_ats_check
  CHECK (ats IN ('greenhouse', 'lever', 'ashby', 'jsonld', 'zoho_rss'));

ALTER TABLE jobs
  ADD COLUMN source_kind  text,
  ADD COLUMN source_label text,
  ADD COLUMN source_url   text;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_source_kind_check
    CHECK (source_kind IS NULL OR source_kind IN ('greenhouse', 'lever', 'ashby', 'jsonld', 'zoho_rss', 'campus_drive', 'user_shared')),
  ADD CONSTRAINT jobs_source_all_or_none
    CHECK ((source_kind IS NULL) = (source_label IS NULL) AND (source_kind IS NULL) = (source_url IS NULL)),
  ADD CONSTRAINT jobs_source_url_https
    CHECK (source_url IS NULL OR (source_url ~ '^https://' AND char_length(source_url) <= 2000)),
  ADD CONSTRAINT jobs_source_label_len
    CHECK (source_label IS NULL OR char_length(source_label) BETWEEN 1 AND 200),
  ADD CONSTRAINT jobs_user_shared_label
    CHECK (source_kind IS DISTINCT FROM 'user_shared'
           OR source_label IN ('Shared from Reddit', 'Shared from WhatsApp', 'Shared from LinkedIn', 'Shared from Telegram', 'Shared link'));

-- Mirrors sourceForPosting() in packages/ingest/src/source.ts (a test keeps the two in step).
CREATE FUNCTION job_source_for_posting(p_posting uuid)
RETURNS TABLE (kind text, label text, url text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT cb.ats,
         left(CASE cb.ats
                WHEN 'greenhouse' THEN 'Greenhouse · ' || c.name
                WHEN 'lever'      THEN 'Lever · ' || c.name
                WHEN 'ashby'      THEN 'Ashby · ' || c.name
                WHEN 'jsonld'     THEN lower(cb.token)
                ELSE coalesce(lower(substring(p.url FROM '^https://([^/?#:]+)')), 'zoho recruit')
              END, 200),
         p.url
    FROM postings p
    JOIN company_boards cb ON cb.id = p.board_id
    JOIN companies c ON c.id = cb.company_id
   WHERE p.id = p_posting AND p.url ~ '^https://' AND char_length(p.url) <= 2000
$$;

CREATE FUNCTION jobs_source_derive() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE s record;
BEGIN
  IF NEW.primary_posting_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_kind IS NOT NULL THEN RETURN NEW; END IF;
  ELSE
    -- re-derive only when the primary posting moved and the caller did not set the source itself
    IF NEW.primary_posting_id IS NOT DISTINCT FROM OLD.primary_posting_id
       OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
       OR OLD.source_kind IN ('user_shared', 'campus_drive') THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT * INTO s FROM job_source_for_posting(NEW.primary_posting_id);
  IF FOUND THEN
    NEW.source_kind := s.kind;
    NEW.source_label := s.label;
    NEW.source_url := s.url;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER jobs_source_derive BEFORE INSERT OR UPDATE OF primary_posting_id ON jobs
  FOR EACH ROW EXECUTE FUNCTION jobs_source_derive();

-- Backfill: primary posting first, else the oldest posting that points at the job.
UPDATE jobs j
   SET source_kind = s.kind, source_label = s.label, source_url = s.url
  FROM (
    SELECT j2.id AS job_id,
           coalesce(j2.primary_posting_id,
                    (SELECT p.id FROM postings p WHERE p.job_id = j2.id ORDER BY p.first_seen_at, p.id LIMIT 1)) AS posting_id
      FROM jobs j2
     WHERE j2.source_kind IS NULL
  ) pick
  CROSS JOIN LATERAL job_source_for_posting(pick.posting_id) s
 WHERE j.id = pick.job_id;

COMMENT ON COLUMN jobs.source_kind IS 'greenhouse | lever | ashby | jsonld | zoho_rss | campus_drive | user_shared';
COMMENT ON COLUMN jobs.source_label IS 'Human-readable origin, e.g. careers.trelliscloud.in or Shared from Reddit';
COMMENT ON COLUMN jobs.source_url IS 'The original posting (https). For user_shared only the pasted URL, never scraped.';
