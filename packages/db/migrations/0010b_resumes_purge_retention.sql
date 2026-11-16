-- 0010b_resumes_purge_retention: a purged resume keeps nothing derived from the file (DPDP erasure, PRD R8).
-- 0010 only nulled parsed_enc, so label (user text, may hold a name), skills[], file_hmac and blob_key survived the purge,
-- and resumes_file_present forced file_hmac and blob_key to stay. The CHECK now exempts purged rows, and a second CHECK
-- makes "purged" imply those columns are empty. Existing purged rows are scrubbed first (their blobs are already gone:
-- the purge deletes the blob before it marks the row).

ALTER TABLE resumes DROP CONSTRAINT resumes_file_present;

UPDATE resumes SET label = NULL, skills = '{}', file_hmac = NULL, blob_key = NULL WHERE purged_at IS NOT NULL;

ALTER TABLE resumes ADD CONSTRAINT resumes_file_present CHECK (
  purged_at IS NOT NULL
  OR (source = 'builder' AND parse_status = 'draft')
  OR (size_bytes IS NOT NULL AND file_hmac IS NOT NULL AND blob_key IS NOT NULL)
);
ALTER TABLE resumes ADD CONSTRAINT resumes_purged_derived_clean CHECK (
  purged_at IS NULL OR (label IS NULL AND skills = '{}' AND file_hmac IS NULL AND blob_key IS NULL)
);

-- Stuck-job sweep (resume:stuck-sweep) and the purge sweep read by status/age.
CREATE INDEX resumes_pending_idx ON resumes (updated_at) WHERE parse_status IN ('uploaded', 'extracting') AND deleted_at IS NULL;
