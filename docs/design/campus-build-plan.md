# Campus build plan (LLD draft)

2026-10-29. Merged from the ECC `planner` and `architect` drafts. The decisions are in PLAN.md Amendment B (proposed, pending owner approval). This file will be expanded into the full LLD before Slice 3. Owner key: **TDD** = tdd-guide, **UI** = main session (loads `frontend-design` first), **MAIN** = main session, non-UI (vendor and library checks), **SEC** = security-reviewer, **DOC** = doc-updater.

## Where the two drafts disagreed, and what we chose
| Topic | planner | architect | Chosen | Why |
|---|---|---|---|---|
| Service layer | `packages/agent/src/services` | new `packages/services` + rule `api-v1-thin` | **packages/services** | keeps agent about LLMs; the rule guarantees web and API share logic |
| Extractor home | `packages/agent/src/resume/extract`, run by the worker | `workers/runner/src/resume/extract` + rule `extractors-worker-only` | **workers/runner** | the existing `workers-not-imported` rule already keeps them out of web |
| Builder PDF | pdf-lib + fontkit | pdfkit + Noto Sans | **pdfkit**, pdf-lib as the fallback | pdfkit wraps text itself; the round-trip test decides |
| Roster | roll-number HMAC + programme + placed | email HMAC only | **email HMAC + placed flag** | roll numbers are guessable and verify no one; placed is needed to drop students from picks |
| Profiles | add `college_tier`, `cohort_code` | move them to the campus tables | **campus tables** | one source of truth |
| Android auth | later | Bearer opaque tokens now, in the design | **design now, build at C3** | `sessions.client` ships in 0008 |
| TPO aggregates | definer functions, k ≥ 10 | definer functions + daily snapshots + complementary suppression + verified-only population | **architect's** | stops differencing and sybil k |

Both agreed on: migrations renumbered (0007 is taken), `dek_wrapped` dropped, the "≤ 3 resumes" trigger counting roots, `idempotency_keys` moved to 0008, no XML parser, upload as a route handler, IDs-only job payloads.

## Slice 1: pure resume and eligibility engine (no auth, no PII, synthetic fixtures)
| ID | Task | Owner |
|---|---|---|
| S1.0 | Contracts (`ExtractResult`, `ResumeSection`, `EducationEntry`, `SensitiveFinding`, `HealthCheck`, `Criterion`, `EligibilityResult`); remove the stray `export const x=1` in `engine/src/index.ts` | TDD |
| S1.1 | Source drive-notice phrasing (about 25 public notices, paraphrased, no names) → labelled criteria corpus (≥ 80 lines) | MAIN, then TDD |
| S1.2 | Synthetic India resume corpus (≥ 40): CBSE/ICSE/state boards, SSLC/PUC/HSC, diploma lateral entry, CGPA/SGPA, ATKT/KT, biodata blocks | TDD |
| S1.3 | Data tables: qualifications, boards, degrees with durations, branch aliases | TDD |
| S1.4 | `engine/resume/sections.ts`, with India-aware headings | TDD |
| S1.5 | `engine/resume/education.ts`: level, board, score + scale, years, backlogs active/history, confidence, offsets | TDD |
| S1.6 | `engine/resume/sensitive.ts` + `verhoeff.ts`: Aadhaar (context-scored), PAN, DOB, parents, religion/caste/marital (labels only), image presence; length-preserving mask | TDD |
| S1.7 | `engine/resume/text-layer.ts`: readable / none / garbled | TDD |
| S1.8 | `engine/resume/health.ts`: the 9 checks, pass/fail/unknown, "N of 9" | TDD |
| S1.9 | `engine/eligibility.ts`: `parseCriteria` + `evaluateEligibility` + CGPA rule (unknown without a rule) | TDD |
| S1.10 | `worthwhile.ts`: optional eligibility condition; existing tests unchanged | TDD |
| S1.11 | `workers/runner/src/resume/extract/`: unpdf (text PDF) and fflate (DOCX) with the zip guard; MAIN verifies the libraries first | MAIN, then TDD |
| S1.12 | Test-time fixture generator: text PDF, image-only PDF, 4-page PDF, PDF with JS, encrypted PDF, DOCX, zip bomb, XXE, .docm | TDD |
| S1.13 | `engine:eval` gains education, sensitive and eligibility evals with thresholds | TDD |
| S1.14 | Review: parsers, ReDoS, no values in findings or errors | SEC |
| S1.15 | `docs/resume.md`, `docs/eligibility.md`, codemap | DOC |

**Acceptance:**
- `pnpm verify` green; engine has zero runtime deps.
- Education field accuracy ≥ 0.90.
- Aadhaar and PAN recall 1.0, with 0 false positives on ≥ 40 negatives.
- Eligibility accuracy ≥ 0.90, with 0 wrong "fail" verdicts.
- Unknown never makes a role non-worthwhile (property test).
- Zip bomb rejected under the byte cap.
- Image-only PDF: `ats_readable` fails and the other 8 checks are unknown.

## Slice 2: accounts (runs in parallel with Slice 1)
- 0008 auth migration.
- Session and OTP helpers; a real `db:verify-auth` (≥ 15 checks).
- Mailer with a file outbox.
- Google OIDC (mock issuer in tests) + email code.
- `__Host-` session cookie.
- 18+ gate via a pending-signup cookie.
- `accounts` flag; delete account.
- UI: `/signin`, `/signin/code`, `/welcome`, `/you`.
- SEC deep review; `docs/auth.md`.
- Optional 2b: phone OTP after the vendor decision.

**Acceptance:**
- 0 users without an `age_18_plus` consent.
- Identical responses for unknown and known emails.
- Logout revokes server-side.
- Flag off → 404.

## Slice 3: upload → confirm → builder → /api/v1
- **Data:** 0009 migration.
- **Services and API:** `packages/services`; v1 routes + a separate OpenAPI doc + contract tests.
- **Upload pipeline:**
  - sealed upload route
  - `resume:extract` in a sandboxed thread
  - mask before seal
  - the health and confirm screens
  - `/you/eligibility`
- **Builder:** `resume:render` (pdfkit) and its screens.
- **Retention:** audited download, purge within 24 h.
- **Checks:** `pnpm budget` (≤ 100 KB per student route), e2e with 1440 and 390 screenshots, SEC deep review, docs.

**Acceptance:**
- An Aadhaar DOCX produces a masked parse and a warning.
- An image-only PDF produces the builder offer.
- A builder PDF round-trips through our extractor.
- Every action has a v1 twin.
- Cross-user requests get 404.
- 0 LLM calls.

## Slice 4: campus
- **4a**, can start before G4 if the owner says so:
  - 0010 campus tables
  - join by code or college email
  - share levels
  - scam flags (pure, could move into Slice 1)
  - the "never charges" card
- **4b**, gated on G4:
  - roster CSV import
  - `campus:stats` snapshots + definer functions
  - TPO console
  - drive inbox
  - outcomes + NAAC export (column shape checked against the NAAC manual)

## After Slice 3
HLD M3–M7: match, picks, swipe, fill, hand-off, tracker. In parallel: supply S1 (board discovery) and S2 (connectors after terms notes).
