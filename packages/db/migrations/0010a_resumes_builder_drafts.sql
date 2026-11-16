-- 0010a_resumes_builder_drafts: two fixes to resumes found in review of 0010 (0010 is applied and checksum-locked).
--   1. A guided-builder draft has no file yet: the 6-8 sealed answers live in parsed_enc and `resume:render` (runner,
--      pdfkit) produces the PDF later. So size_bytes, file_hmac and blob_key become nullable, with a CHECK that every
--      row other than a builder draft still has all three.
--   2. 0010 let the app role INSERT extractor-owned columns, so a student could insert a row that is already
--      "9 of 9 healthy" with no sensitive findings. The INSERT grant is narrowed to what the services write. The
--      extractor and render worker (owner role) write pages, text_layer, producer_family, health*, sensitive_kinds,
--      reject_code and purged_at. UPDATE was already narrow.

ALTER TABLE resumes ALTER COLUMN size_bytes DROP NOT NULL;
ALTER TABLE resumes ALTER COLUMN file_hmac DROP NOT NULL;
ALTER TABLE resumes ALTER COLUMN blob_key DROP NOT NULL;
ALTER TABLE resumes ADD CONSTRAINT resumes_file_present CHECK (
  (source = 'builder' AND parse_status = 'draft')
  OR (size_bytes IS NOT NULL AND file_hmac IS NOT NULL AND blob_key IS NOT NULL)
);

REVOKE INSERT ON resumes FROM hirelane_app;
GRANT INSERT (id, user_id, parent_id, label, source, mime, size_bytes, file_hmac, blob_key, parse_status, parsed_enc,
              parsed_version, skills, confirmed_at, is_default)
  ON resumes TO hirelane_app;
