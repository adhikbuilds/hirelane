# Resume pipeline (Slices 1 and 3)

**Status:** Slice 1 (pure engine and extraction library) and Slice 3 (upload, extract, confirm, eligibility API, builder, download, purge) are built, uncommitted, 2026-10-29. The Slice 3 wiring is in `packages/services/src/{resumes,eligibility,builder}.ts`, `workers/runner/src/tasks/resume-*.ts` and `apps/web/app/api/v1/resumes/**`. The eligibility screen `/you/eligibility` is not built: its folder holds only `actions.ts`, and `pnpm budget` lists it as "not built".

**Owner files:** `packages/engine/src/resume/` (pure), `workers/runner/src/resume/` (I/O: sandboxed extraction, pipeline, render), `packages/services/src/{resumes,seal,aad,parsed,eligibility,builder}.ts` (service layer), `packages/engine/scripts/evals/sensitive.ts` and `education.ts` (gates).

## 0. End to end (Slice 3)

```
POST /api/v1/resumes ──► uploadResume ──► row (uploaded) + sealed blob + enqueue resume:extract {id}
                                                 │
resume:extract ──► pipeline.ts (gate → sandboxed extract → normalise → mask → health → education)
                   ──► row (parsed | needs_text), parsed_enc sealed
                                                 │
GET /api/v1/resumes/{id}  (masked parse)          │
POST /api/v1/resumes/{id}/confirm  ──► new version, made default, eligibility upserted
GET|PUT /api/v1/eligibility         ──► profile + field_meta provenance
POST /api/v1/builder/steps → POST /api/v1/builder/finish ──► resume:render (pdfkit, id only) ──► extract
GET /api/v1/resumes/{id}/file       ──► original bytes, audited in file_access_log (same transaction)
DELETE /api/v1/resumes/{id}         ──► deleted_at + purge_after (versions too) ──► resume:purge
```

**Upload** (`POST /api/v1/resumes`, a route handler, not a server action; PLAN Amendment B). The body is raw, capped at 5 MiB (`MAX_RESUME_BYTES`), and rate limited per user. Checks, with the error each returns:

- Type: only PDF and DOCX. The magic bytes must match the declared type (`bad_file_type` 415 otherwise).
- Size: a declared length over 5 MiB, or a stream that crosses the cap, is `file_too_large` 413. An empty body is `empty_file` 400.
- Cap: at most 3 resumes per student. Drafts count (`too_many_resumes` 409).
- Duplicate: the same file twice is `duplicate_resume` 409. The check uses a file HMAC.
- The blob is sealed under `resumeBlobAad` (`aad.ts`). The original file name lives only inside `parsed_enc`.
- The job payload carries the resume id only. The enqueue is keyed `resume:extract:{id}`. If the enqueue fails, the route returns `queue_unavailable` 503, the row remains, and `resume:stuck-sweep` re-queues it.
- `Idempotency-Key` makes a repeat return the stored response and queue no second job.

**Extract** (`resume:extract`, `workers/runner/src/tasks/resume-extract.ts`, which calls `resume/pipeline.ts`). The pipeline has no DB, no vault, no network and no LLM calls. It runs the gate, the sandboxed extraction (§2), normalisation, the text layer, sections, sensitive detection, health (§3) and `parseEducation` (§1). Sensitive values are masked before the parse is sealed (§4). The task writes the extractor-owned columns as the owner role, because `hirelane_app` has no grant on them. Outcomes covered by tests:

- A DOCX with an Aadhaar number ends masked, with the kind flagged and no value in the row. The original blob is untouched (`resume-pipeline-db.test.ts`, "Aadhaar DOCX: masked parse, kind flagged, no value anywhere in the row"). The same case is in `resume-f1-integration.test.ts`. Both are skipped unless the test database is local.
- An image-only PDF stops at `needs_text`, and it cannot be confirmed (`resume-f1-integration.test.ts`).
- A 4-page PDF is rejected with `pages` NULL (`resume-pipeline-db.test.ts`).
- A missing blob fails the row. It does not stay in `extracting`.

**Read.** `GET /api/v1/resumes/{id}` returns the opened, masked parse. `GET /api/v1/resumes` returns summaries only. `GET /api/v1/me/export` contains the parse but no blob key and no file hash (`api-v1.test.ts`, "get and export; the export has the opened parse but no blob key or file hash").

**Confirm** (`POST /api/v1/resumes/{id}/confirm`, body `parsedVersion` and `eligibility`). It creates a new version, makes it the default and upserts the eligibility profile. Rules:

- `stale_parse` 409 when `parsedVersion` is not the current parse.
- `not_confirmable` 409 for a resume that has not been parsed, or that is `needs_text`.
- Bad numbers are 400 with an issue path, for example `eligibility.pct_10` `too_big`. Values never appear in an error.
- Provenance is recorded per field in `field_meta`. A value taken from the resume has `source: 'resume'`. A value the student supplied, or one the parse does not contain, has `source: 'user'`. For example, the parse has no 10th percentage, so `pct_10` is `'user'`, while `grad_score` and `passout_year` are `'resume'` (`api-v1.test.ts`, "confirm creates a new version…").

**Eligibility** (`GET` and `PUT /api/v1/eligibility`, `packages/services/src/eligibility.ts`). `PUT` saves the profile and counts as confirmation: it sets `confirmed_at`. Values are validated by `EligibilityValues`. Errors never echo values (`api-v1.test.ts`, "PUT eligibility validates…"). The matching against drives is in `docs/eligibility.md`. There is no UI for this yet.

**Builder** (`POST /api/v1/builder/steps`, then `POST /api/v1/builder/finish`). Each step is sealed into a draft. Answers are validated to the renderer's limits and are never echoed in errors. Finish requires every required step (`incomplete_draft` 422 otherwise). It then queues `resume:render` with the id only, and returns 202. Only the owner can edit or finish a draft. Render (`workers/runner/src/resume/render/`) uses pdfkit, one column, one page, no network and no embedded JavaScript. The round trip is checked: the rendered PDF goes through the real pipeline and must come back `parsed`, readable, one page, with 9 of 9 checks passing (`resume-render.test.ts`, "goes through the real pipeline as a parsed, readable, one page resume"). The builder offer for an image-only PDF is not covered by any test (see `docs/design/campus-build-plan.md`, Slice 3).

**Download.** `GET /api/v1/resumes/{id}/file` returns the original bytes. The `file_access_log` row is written in the same transaction. A missing blob is a 404 with no audit row. A row that points at another user's blob key is a 404.

**Delete and purge.** `DELETE /api/v1/resumes/{id}` sets `deleted_at` and `purge_after` together. It takes the versions too, and hides the resume. A version whose root was deleted or replaced is hidden. Purge is described under "Retention and recovery" below.

### 0.1 Tasks and crontab

| Task | Trigger | What it does |
|---|---|---|
| `resume:extract` | upload, the builder render, and the stuck sweep | the pipeline above |
| `resume:render` | `finishBuilder` | renders the builder draft to PDF, then queues extract |
| `resume:purge` | delete, and extract (replacing an Aadhaar or PAN original) | deletes the blobs, then nulls the derived columns (0010b) |
| `resume:purge-sweep` | hourly (`13 * * * *`) | purges every row whose `purge_after` has passed, and any row deleted 23 h ago or more. Soft-deletes a superseded original that held an Aadhaar, VID or PAN, once the student has a newer clean resume |
| `resume:stuck-sweep` | hourly (`43 * * * *`) | re-queues extract for rows in `uploaded` for more than 10 minutes, and resets `extracting` rows older than 5 minutes |
| `idempotency:sweep` | hourly (`27 * * * *`) | deletes idempotency keys older than 24 hours |

Migrations for this slice are `0010_resumes_profiles`, `0010a_resumes_builder_drafts` and `0010b_resumes_purge_retention`. The build plan's "0009" label for Slice 3 is out of date: `0009` is the Slice 2 auth hardening migration.

## Slice 1 detail (pipeline, limits, rules)

## 1. Pipeline

```
bytes ──► gate ──► extract ──► normalise ──► text layer ──► sections ──► sensitive ──► health
          (parent)  (sandbox)   (NFKC, offsets)                          (mask before seal)
                                                 └──► education (parseEducation, confirm screen)
```

1. **Gate (parent, before any copy or IPC).** Size over 5 MiB (`MAX_BYTES`) gives `too_large`. The magic bytes must be `%PDF-` or `PK\x03\x04`, otherwise `bad_magic`.
2. **Extract.** Two entry points:
   - `extractInThread` (`extract/thread.ts`) is the production entry for untrusted uploads. It forks `extract/child.ts`, which runs under the limits in §2.
   - `extractResume` (`extract/index.ts`) is the in-process core with no sandbox. It must not be used for uploads. It is also where `active_content` is enforced, and it caps the text at 200,000 characters (`MAX_TEXT_CHARS`).
3. **Normalise.** `normalizeResumeText` (`engine/src/resume/sections.ts`) applies NFKC, LF line endings, removes zero-width and soft-hyphen characters, and maps Devanagari and Arabic digits to ASCII. Every offset in the pipeline is a UTF-16 index into this normalised text, `[start, end)`. `sensitive.ts` re-exports the same function, so there is one offset space.
4. **Text layer** (`text-layer.ts`): `none`, `garbled`, `partial` or `readable`. Details in §3.
5. **Sections** (`sections.ts`): `detectSections` returns `{kind, heading, start, end}` spans. Kinds: `header`, `education`, `personal`, `declaration`, `objective`, `summary`, `contact`, `projects`, `internships`, `experience`, `certifications`, `achievements`, `activities`, `skills`, `links`, `languages`, `interests`. The type is named `ResumeSectionKind` in the engine exports, because `SectionKind` already belongs to the requirements module. Headings are matched against a list of common variants, including Indian forms such as "Academic Profile", "Academic Record" and "Scholastic Record".
6. **Sensitive** (`sensitive.ts`, `verhoeff.ts`). See §4. Findings carry kind, offsets and severity. They never carry the value.
7. **Health** (`health.ts`). Nine fixed checks. See §3.

`parseEducation` (`education.ts`) runs alongside this for the confirm screen. It fills level, board, score and scale, start and passout years, degree, branch, backlogs (active and history kept separate) and a confidence value. Each row carries evidence spans.

## 2. Extraction limits and reject codes

Rejects are returned as `{ rejected: RejectCode }`. Error messages are never forwarded, because they could echo file content.

| Code | Emitted by | Meaning |
|---|---|---|
| `too_large` | gate (parent and `extractResume`) | Over 5 MiB |
| `bad_magic` | gate | Neither a PDF nor a ZIP signature |
| `encrypted` | `pdf.ts` | Encrypted PDF |
| `too_many_pages` | `pdf.ts` | More than `MAX_PDF_PAGES` = 3 pages. A 4-page fixture exercises this path. Health's `one_page` fail can therefore only appear for 2 or 3 pages |
| `zip_guard` | `zip-guard.ts` | DOCX: `altChunk`, a nested archive, too many entries, or a size or ratio cap |
| `macro` | `zip-guard.ts`, `docx.ts` | DOCX or `.docm` with a macro project |
| `active_content` | `extractResume` | PDF with JavaScript or embedded files, or DOCX with embedded files. `extractPdf` reports the flags as data instead |
| `doctype` | `docx.ts` | XML `DOCTYPE` (XXE guard). No XML parser is used |
| `parse_error` | any | Corrupt or truncated file, or any unexpected exception |
| `timeout` | `thread.ts` | Child exceeded the 10 s wall clock |

A child killed for going over 640 MB RSS returns `parse_error`, not `timeout`. So does a child that exits without a result.

**Zip guard caps** (`zip-guard.ts`, `DEFAULT_LIMITS`): at most 300 entries, 10 MiB per entry, 25 MiB inflated in total, and an inflate ratio of 200:1 once an entry has produced more than 64 KiB. Inflation runs in 1 KiB input slices.

**Sandbox** (`thread.ts`, `child.ts`, `limits.ts`):
- The child gets an empty environment (`env: {}`), so no secrets and no DB URL.
- Node flags: `--max-old-space-size=256`, a small semi-space, a stack cap, and `--permission`, with filesystem read limited to the workspace and no write, no child processes and no workers.
- A 10 s wall clock, then `SIGKILL`.
- An RSS watchdog polls `ps -o rss=` every 100 ms and kills the child above 640 MB. It shells out to `ps`, so it works on macOS and Linux only.
- Text returned is capped at 200,000 characters. pdf.js receives `maxImageSize`.
- Node below 22.18 makes `extractInThread` throw an `Error` at once. It does not return `parse_error` for every upload. `nodeSupportsExtraction()` checks this.
- **Not restricted:** the network. Node's permission model does not cover it, so network isolation of the child needs a container or network policy. This is not done.

**Test evidence (verify, 2026-10-29):** the Flate-bomb test inflates about 1 GB from about 1 MB. Without the watchdog the child inflated it all. With it, the child dies in about 0.4 s, the parent's RSS stays flat, and a normal job still works afterwards. `workers/runner/test/resume-extract.test.ts` covers `zip_guard` cases, the zip bomb under the byte cap, corrupt zips as `parse_error`, and the thread path.

**PDF notes.** pdf.js `isEvalSupported` is not load-bearing, and the file says so. `doc.getAttachments()` is a fallback for object-stream cases.

**DOCX notes.** Runs under `w:vanish` are dropped, including `w:val="0"`, and the state resets per run. `javascript` and `macros` in `ExtractFlags` are `false` for DOCX meaning "not checked". Making that tri-state needs a types change. Vanished text is not flagged.

## 3. Text layer and the nine health checks

**Text layer** (`assessTextLayer`):
- `none`: fewer than 30 non-space characters per page on average. DOCX counts as one page.
- `garbled`: more than 30% of non-space characters are private-use (U+E000 to U+F8FF) or U+FFFD.
- `partial`: at least one page has fewer than 10 non-space characters.
- `readable`: otherwise.

**Health rules.** `assessHealth` returns each check as `pass`, `fail` or `unknown`, with a reason and a fix. Reasons never echo resume content or the file name. The summary is "N of 9 checks pass". There is no score out of 100. Failing checks sort first, then unknown, then passing.

If the layer is `none` or `garbled`, `ats_readable` fails and the other eight are `unknown`. If the layer is `partial`, `ats_readable` fails but the other checks still run.

| # | Check id | Pass when | Fail when | Unknown when |
|---|---|---|---|---|
| 1 | `ats_readable` | layer is `readable` | layer is `partial`, `none` or `garbled` | never on its own |
| 2 | `one_page` | `pages === 1` | `pages` is 2 or more | DOCX, or page count unreadable |
| 3 | `contact_present` | an email and a phone are both present | either is missing | never |
| 4 | `no_biodata_ids` | no sensitive finding other than `image` | any Aadhaar, VID, PAN, DOB, parent, religion, caste or marital finding | never |
| 5 | `no_padding` | no `declaration`, `personal` or `interests` section, and no "I hereby declare" | any of them | never |
| 6 | `bullets_with_numbers` | at least half of the bullets in experience, projects or internships include a digit (or the whole text, if none of those sections exist) | fewer than half, or no bullets at all | never |
| 7 | `project_proof_links` | a projects section contains a link (GitHub, GitLab, Bitbucket, a deploy host, or `http(s)://` or `www.`) | no projects section, or none of them has a link | never |
| 8 | `skills_in_text` | the skills section lists at least 3 items | no skills section, or fewer than 3 items | never |
| 9 | `sensible_file_name` | `checkFileName` finds no problem | camera name, messaging app, `untitled`, a copy suffix, or no person-like token | no file name was given |

**Email and phone patterns.** Email is a standard local@domain form. Phone is an Indian mobile number: optional `+91` or `91`, then a leading digit 6 to 9, 10 digits in all, with optional spaces or a hyphen.

**File-name checker** (`checkFileName`) returns problem codes only: `camera_name`, `messaging_app`, `placeholder_name`, `copy_suffix`, `no_person_token`. Stop-words such as resume, cv, final, copy and the job-application words are ignored when looking for a name token.

## 4. Sensitive data

`detectSensitive(text, meta?)` returns `SensitiveFinding[]`. A finding is `{kind, start, end, severity}` with no value field, by design.

| Kind | Severity | Rule |
|---|---|---|
| `vid` | high | 16-digit VID, when labelled or Verhoeff-valid |
| `aadhaar` | high, medium or low | 12 digits starting 2 to 9. Labelled: high if Verhoeff-valid, otherwise low. Unlabelled: medium, and only if Verhoeff-valid, written as digits with at most spaces or hyphens between them (not the dot, slash or line-break forms), and not a contiguous 91-prefixed number whose third digit is 6 to 9 (read as a mobile number) |
| `aadhaar_masked` | low | Already-masked forms such as `XXXX XXXX 1234` |
| `pan` | high | Five letters, four digits, one letter, with holder type including K. Spaces or hyphens inside the PAN need a PAN label. Otherwise it must be uppercase |
| `dob` | medium | Date-of-birth labels and forms, plus age lines |
| `parent_name` | medium | Father's, mother's or guardian's name labels |
| `religion`, `caste`, `marital_status` | per label | Labels only. Flagged, not masked |
| `image` | low | Emitted when `meta.imageCount > 0` |

**Context.** The labels are checked in a 40-character window before the number. A label in that window is an absolute boost. Suppression applies only when no such label exists, and only for these: a phone-like label (mobile, phone, whatsapp, and so on), a roll or registration number, an order, invoice or account, or a `+91` prefix. Covered phrasings include "linked mobile", "(student ID proof)" and "Number - Contact".

**Separators.** Aadhaar groups may be separated by up to three of space, tab, `.`, `/`, `-` or a line break. Mixed separators are allowed. A digit-by-digit spaced form is matched when labelled. Without a label, the number must be written with spaces or hyphens only, so a dotted, slashed or line-wrapped number is not flagged unless it has a label.

**Masking.** `maskSensitive` is length-preserving. Every letter or digit inside an Aadhaar, VID or PAN finding becomes `X`, and separators stay. It masks **only** those three kinds. DOB, parent names, caste and religion are flagged, not masked, and need a consent or redaction decision downstream. Callers must persist and send only the masked, normalised text.

**Scanning cost.** Every quantifier on free text is bounded, there are no nested unbounded quantifiers, and context windows are capped at 40 characters. A 300 KB input scans in under 2 seconds, and masking leaves no leak in the tests. There is no length cap inside the detector. The extractor already caps text at 200 KB, and a cap in the detector would risk leaving the tail unmasked.

**Verhoeff** (`verhoeff.ts`): standard checksum. `verhoeffValid` and `verhoeffCheckDigit`.

## 5. Tests and gates

| What | Where | Gate |
|---|---|---|
| Sensitive recall and false positives | `engine:eval` `evals/sensitive.ts` | Aadhaar and PAN recall must be 1.0, with 0 false positives over at least 40 negatives. The corpus has 78 labelled rows |
| Education field accuracy | `engine:eval` `evals/education.ts` | At least 0.90 |
| Resume unit tests | `packages/engine/test/resume-*.test.ts` | Sections, education, sensitive, hardening, text layer, health |
| Synthetic resumes | `packages/engine/test/corpus/resumes.synthetic.jsonl` | 48 rows: CBSE, ICSE, state boards, SSLC, PUC, HSC, diploma lateral entry, CGPA and SGPA, ATKT and KT, biodata blocks |
| Extract tests | `workers/runner/test/resume-extract*.test.ts`, `workers/runner/test/fixtures/` | Reject codes, zip guard, thread sandbox, Flate bomb |

**Caveat on the eval numbers.** The corpora were labelled by the same agents who wrote the parsers. The 100% scores are regression guards, not measured accuracy. A real measurement needs a corpus labelled independently, with real but consented or public-domain notices and resumes.

## 6. Open items and deliberate gaps

- **Network isolation** of the extraction child is a deploy precondition, not code: see "Deploy preconditions" below.
- **Unlabelled contiguous 91x numbers** are discarded as phones. Owner decision: flagging them costs more false positives. Say if you want that changed.
- **Zip guard:** no local-header name cross-check and no fuzz test yet. The caps are unchanged and real.
- **DOCX tri-state flags** (`javascript`, `macros`) and flagging vanished text.
- **Only Aadhaar, VID and PAN are masked.** Callers must send only the masked text.
- **Mac and Linux only** for the RSS watchdog.
- The engine exports and eval scripts are listed in `docs/architecture.md` §6.

## Extraction sandbox (ADR: child process, not worker thread)

Amendment B section 2 and the build plan said a fresh `worker_threads` Worker with `resourceLimits` of 256 MB. What was built is a forked **child process** per job (`workers/runner/src/resume/extract/thread.ts`). It is stronger isolation: a hostile file can only kill the child, the environment is empty, and Node's permission model applies. Limits actually used:

| Limit | Value |
| --- | --- |
| V8 old generation | 256 MB (`--max-old-space-size`) |
| Resident set (RSS watchdog, polled every 100 ms, because pdf.js decodes into ArrayBuffers outside the V8 heap) | 640 MB |
| Wall clock | 10 s, then SIGKILL |
| Environment | empty (no `DATABASE_URL`, no master key) |
| Permissions | `--permission`: no child processes, no workers, no writes; read only the `extract/` folder and the real folders of `unpdf` and `fflate` (plus their symlinked `node_modules` entries for package resolution) |

The repo root, `.env`, `.env.local` and the default `./storage` folder are **not readable** by the child (tested in `workers/runner/test/resume-extract-thread.test.ts`). Requires Node 22.18 or later (`engines` was raised). pdf.js is 6.1.200, past the CVE-2024-4367 fix, so this is defence in depth.

## Deploy preconditions

1. **The runner must run in a network-isolated container (no egress) or behind a firewall that blocks outbound traffic from the extraction child.** Node's permission model does not restrict the network, so if hostile file content ever ran code inside pdf.js, only network isolation stops it sending out what it can read. This is required before the pilot.
2. `HIRELANE_MASTER_KEY` and `DATABASE_URL` are read by the parent process only.
3. Cron: `resume:purge-sweep` (hourly), `resume:stuck-sweep` (hourly) and `idempotency:sweep` (hourly, deletes keys older than 24 h) must be running (`workers/runner/crontab`).

## Retention and recovery

- **Account delete** removes every stored file first (`apps/web/lib/auth/erasure.ts`, called inside `deleteAccount` before the `users` DELETE; a failed file delete rolls the whole delete back so it can be retried), then the rows cascade.
- **Purge** deletes the blobs, then nulls `parsed_enc`, `label`, `skills`, `file_hmac` and `blob_key` and sets `purged_at` (migration 0010b).
- **Stuck resumes:** `resume:stuck-sweep` resets rows left in `extracting` for more than 5 minutes (worker died) and re-queues extract for rows in `uploaded` for more than 10 minutes (enqueue failed). `resume:render` no longer deletes the blob once the row is committed.

## Related

- `docs/eligibility.md` for criteria matching against the education rows.
- `docs/auth.md` for the sign-in and account side, and for erasure (`lib/auth/erasure.ts`), which removes stored files before the account rows.
- `docs/public-api.md` §14 for the v1 routes that wrap this pipeline.
- `docs/architecture.md` §4.3 for the task catalogue and §6 for the codemap.
- `docs/design/campus-build-plan.md` for the Slice 1 and Slice 3 tasks and acceptance.
