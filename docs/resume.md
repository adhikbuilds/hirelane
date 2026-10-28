# Resume pipeline (Slice 1)

**Status:** built, uncommitted, 2026-10-29. Pure engine code plus an extraction library in the runner. Nothing calls the extractor yet: no runner task and no upload route. Both arrive in Slice 3 (`resume:extract`, see `docs/architecture.md` §4.3).

**Owner files:** `packages/engine/src/resume/` (pure), `workers/runner/src/resume/extract/` (I/O, sandboxed), `packages/engine/scripts/evals/sensitive.ts` and `education.ts` (gates).

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

- **Network isolation** of the extraction child needs a container or network policy. Not done.
- **Unlabelled contiguous 91x numbers** are discarded as phones. Owner decision: flagging them costs more false positives. Say if you want that changed.
- **Zip guard:** no local-header name cross-check and no fuzz test yet. The caps are unchanged and real.
- **DOCX tri-state flags** (`javascript`, `macros`) and flagging vanished text.
- **Only Aadhaar, VID and PAN are masked.** Callers must send only the masked text.
- **Mac and Linux only** for the RSS watchdog.
- **No runner task** registers the extractor yet (`resume:extract`, Slice 3). Nothing stores an upload.
- The engine exports and eval scripts are listed in `docs/architecture.md` §6.

## Related

- `docs/eligibility.md` for criteria matching against the education rows.
- `docs/auth.md` for the sign-in and account side. Upload and seal rules come with Slice 3.
- `docs/design/campus-build-plan.md` for the Slice 1 and Slice 3 tasks and acceptance.
