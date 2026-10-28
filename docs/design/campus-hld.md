# Hirelane campus HLD

Version 1.0, 2026-10-29. This covers what we integrate and how, at the box-and-arrow level. Business: [../product/CAMPUS-FIRST.md](../product/CAMPUS-FIRST.md). Requirements: [../product/CAMPUS-PRD.md](../product/CAMPUS-PRD.md). Binding scope: PLAN.md Amendment B. Table-level LLD comes later, from the planner and architect drafts summarised in [campus-build-plan.md](campus-build-plan.md).

## 1. System context
```
                        ┌─────────────── Hirelane ───────────────┐
 Student (phone) ──────▶│ apps/web  (pages + /api/v1)            │──▶ Google OIDC (sign-in)
 TPO (laptop)    ──────▶│   │                                    │──▶ Mail sender (6-digit codes; file outbox in dev)
 Ops             ──────▶│ packages/services  (one service layer) │
                        │   │        │                           │
                        │ engine   db (Postgres + RLS)  vault    │
                        │ (pure)   graphile-worker      (envelope│
                        │                               crypto + │
                        │ workers/runner ◀── queue      blobs)   │
                        │   extract · render · match · ingest ·  │
                        │   campus stats · purge                 │
                        └──┬───────────────┬───────────────┬─────┘
                           │               │               │
            Public ATS APIs (read)   Employer apply form   Files in/out
            Greenhouse, Lever,       (student submits      Cohort CSV in (Superset/ERP export)
            Ashby; S2 after terms    there; we only hand   NAAC 5.2.1 CSV out
            notes                    off)                  Drive notice text in (pasted by TPO)
```

## 2. Components and responsibilities
| Component | Status | Does | Never does |
|---|---|---|---|
| `apps/web` | exists (public board, API, status, privacy) | server-rendered student and TPO pages; `/api/v1` routes; auth cookies | parse files, touch the DB directly from routes (rule `api-v1-thin`) |
| `packages/services` | **new** | one function per feature, `withUser` only, zod input; called by both server actions and `/api/v1` | `withAdmin`, file parsing |
| `packages/engine` | exists (skills, salary, level, role family, requirements, fresher, worthwhile, dedup, places) | **adds:** resume sections, education parse, sensitive scan, health checks, text-layer verdict, eligibility, scam flags | I/O of any kind (pure; zero runtime deps) |
| `packages/db` | exists (migrations 0001–0007, RLS posture, verify harnesses) | adds 0008 auth → 0013 drives/outcomes; SECURITY DEFINER functions for TPO aggregates | expose cross-user rows to the app role |
| `packages/vault` | exists (envelope crypto, local blob store, key provider) | seals resumes, offer letters, CSV imports | — |
| `packages/ingest` | exists (Greenhouse, Lever, Ashby connectors, run stats) | board discovery (S1); S2 connectors after terms notes | scrape any site, or fetch outside the source allowlist |
| `workers/runner` | exists (ingest, enrich, cron) | **adds:** `resume:extract` (PDF/DOCX in a sandboxed thread), `resume:render` (builder PDF), `resume:purge`, `campus:stats`, `drive:evaluate` | run in the web process |
| `packages/agent` | exists (LLM providers, fixture mode) | later: consented LLM extras only | anything in C1 (0 LLM calls) |

## 3. Integrations: what and how
| # | Integration | Direction | How | Auth / trust | Data crossing | Release |
|---|---|---|---|---|---|---|
| I1 | Google sign-in | out → in | OIDC + PKCE; later the Android ID-token exchange | Google JWKS | email, `sub` | C1 |
| I2 | Email codes | out | `Mailer` interface: file outbox in dev, a real sender later (Azure or other, vendor-neutral) | sender keys in env | the code only | C1 |
| I3 | Phone OTP (optional) | out | `OtpSender` interface; SMS or a WhatsApp authentication template | vendor, after the owner picks one; DLT registration (verify) | the code only | C1+ |
| I4 | Public ATS boards | in | existing connectors, every 6 h; board discovery probes public endpoints | public, read-only, allowlisted hosts | public job data | exists; S1 now |
| I5 | More ATS sources (Workday, SuccessFactors, Darwinbox, Keka, Zoho Recruit) | in | the same connector contract, each with a dated terms note in docs/recon before merge | public pages only | public job data | S2, after notes |
| I6 | Employer apply form | hand-off | copy pack plus "open the employer's form"; the student submits | none: we never submit | answers the student copies | M5–M6 |
| I7 | Placement ERP (Superset or any other) | in (file) | the TPO uploads a CSV export (emails + placed flag); sealed, parsed in the worker, blob deleted ≤ 24 h | TPO session | email HMACs, placed flag | C2 (G4) |
| I8 | Drive notices | in (text) | the TPO pastes notice text and a link; **we never fetch the link** | TPO session | criteria, link | C2 (G4) |
| I9 | NAAC 5.2.1 | out (file) | CSV export of consented outcomes; formula-injection safe; audited | TPO session | name, programme, employer, package, verification | C2 (G4) |
| I10 | Android app (future) | in | the same `/api/v1`, Bearer opaque tokens in the `sessions` table | `hl_at_` tokens | the same as web | C3 |
| I11 | LLM (optional, later) | out | `packages/agent` provider, only with the `llm_resume` consent | consent + per-user cost cap | the resume text the user consented to share | after C1 |

## 4. Key flows
**F1 Resume: upload → confirm**
1. Phone → `POST /api/v1/resumes`: size cap, magic bytes, `accounts` flag. The file is sealed to the blob store; the row is set to `uploaded`.
2. The queue job carries IDs only. `resume:extract` runs in a sandboxed thread: text, page count, text layer.
3. Engine steps: sensitive scan (Aadhaar and PAN masked before sealing the parse), then sections + education, then 9 health checks.
4. The student sees "N of 9 pass". If the resume is unreadable, they get two fixes: re-export, or use the builder.
5. Confirm screen → a new version + `eligibility_profiles` (clear numbers, RLS own) → matching.

**F2 Eligibility in picks and drives**
1. Posting or drive text → `parseCriteria` → criteria with evidence.
2. Confirmed profile + college CGPA rule → `evaluateEligibility` → pass/fail/unknown per criterion.
3. Fail is a worthwhile-gate blocker. Unknown is shown, never blocks.

**F3 Campus join**
1. Code (rate-limited, HMAC lookup) or college email (6-digit code to the college address; ops-entered domains).
2. The student picks a cohort; share level defaults to aggregate; every change is a consent row.

**F4 TPO aggregates**
1. A nightly `campus:stats` worker writes `cohort_stats_daily`, counting only verified members.
2. k = 10 with complementary suppression and rounding to 5.
3. The TPO reads through SECURITY DEFINER functions under `withUser`. They never get rows and never get filters.

**F5 Outcomes → NAAC**
1. The student marks interview/offer and may attach a letter (sealed; shared with the TPO only if the student opts in).
2. The TPO verifies. Export includes only outcomes/full share levels, labelled "student-reported" or "TPO-verified". Every read is logged and visible to the student.

## 5. Data domains (detail in the LLD)
| Domain | Holds | Who reads | Protection |
|---|---|---|---|
| Identity | users, identities, sessions, codes, consents | the user; auth code | RLS; hashes; append-only consents |
| Resume | sealed files, masked parse, health, sensitive kinds | the user | envelope encryption, purge within 24 h, audited download |
| Eligibility | confirmed academic numbers | the user; SQL aggregates | RLS; plain columns written only on confirm |
| Jobs | public postings, cards, facets | everyone | public |
| Campus | campuses, domains, cohorts, members, roster HMACs, TPO staff | members (own rows); TPO via functions | tenant policies + definer functions + access log |
| Drives & outcomes | drive criteria; student outcomes and letters | eligible members; TPO via functions | share levels; letters sealed |

**Trust boundaries:**
1. The internet ↔ web: Origin checks, rate limits, size caps.
2. Web ↔ worker: IDs only; files parsed only in the worker sandbox.
3. App role ↔ cross-user data: only definer functions and allowlisted `withAdmin`.
4. Student ↔ TPO: share levels and k ≥ 10.

## 6. Reuse map: what we don't build from scratch
**We don't copy competitors' code, screens or data.** Superset and Naukri Campus are closed-source, and copying their UI, copy or data infringes their rights and breaks our CLAUDE.md rule. We do three legal things instead.

**6.1 Our own code, already built (most of the backbone):**
- **Jobs pipeline:** ingest connectors (Greenhouse, Lever, Ashby), run stats, 129 companies / 16.8k roles.
- **Enrichment engine:** skills, salary with traces, level, role family, visa, workplace, requirements extraction, dedup, places, **fresher flag, worthwhile gate**.
- **Public surface:** public board, public API with OpenAPI, llms.txt, sitemaps, status, privacy, terms and contact pages.
- **Security base:** vault (envelope crypto, blob store, keys), RLS posture with the verify harness, the withAdmin allowlist guard, rate limits, CI verify.
- **Design system and Wrapped mocks** for the student UI.

**6.2 Open source with permissive licences (we can reuse the code, with attribution; verify each licence and version before adopting):**
| Need | Project | Licence | How we use it |
|---|---|---|---|
| Resume data format | JSON Resume schema | MIT (verify) | our parsed and builder output maps to it, so imports and exports work with other tools |
| Builder templates, ATS-safe layout, import ideas | Reactive Resume (AmruthPillai/Reactive-Resume) | **MIT** [site, read 2026-10-29] | reuse template layout logic and the JSON Resume import mapping; its stack (React 19, Drizzle, Postgres, OpenAPI) is close to ours |
| PDF text | unpdf / pdf.js | MIT / Apache-2.0 (verify) | extraction in the worker |
| DOCX text | fflate | MIT (verify) | zip reading with our own guard |
| PDF render | pdfkit + Noto Sans | MIT + OFL (verify) | builder output |
| Resume parser algorithm | OpenResume (xitanggg/open-resume) | **AGPL-3.0** [site] | **study only:** the AGPL's network clause would oblige us to publish our source, so we don't copy its code. We learn from its published parser write-up |

**6.3 Competitor workflows, studied from public pages and our own free accounts (as docs/recon did for Shortlist):**
- **Superset:** TPO vocabulary (drives, eligibility, shortlists, rounds, offers); student console flow; how one assessment spans employers.
- **Naukri Campus and Unstop:** fresher onboarding and how they show eligibility.
- **Handshake:** the network model, where career centres adopt and employers pay.
- Output: `docs/recon/<name>-notes.md` with "replicate / beat / never copy" sections.

## 7. Non-functional
- **Light:**
  - server-rendered, ≤ 100 KB JS per student page (checked by `pnpm budget`)
  - heavy work only in the worker
  - no new infrastructure
  - 0 LLM calls in C1
- **Security:**
  - sandboxed parsers with byte caps
  - no XML parser for DOCX (no XXE)
  - pdf.js pinned past CVE-2024-4367
  - Origin checks, idempotency keys
  - security-reviewer on every slice
- **Privacy (DPDP 2023):**
  - consents append-only, 18+ gate
  - ID numbers never stored in parsed text
  - deletion within 24 h
  - the college as data fiduciary for its roster, Hirelane as processor (DPA before the pilot)
- **Reliability:** idempotent jobs (jobKey), stuck-job sweep, honest status pages.

## 8. Left for the LLD
- Exact columns, indexes and grants per migration (0008–0013). Drafted by the architect; Amendment B §7, §13 and §15 hold the decisions.
- The verify-rls additions (`own-r`, `ten`, the definer registry).
- `/api/v1` route list and OpenAPI schemas.
- Library verification (versions, licences, CVE fixes) and the 9 health-check thresholds.
- Drives and the application tracker (PRD open decision 5).
