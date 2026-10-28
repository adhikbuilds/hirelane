# Hirelane core loop: HLD and LLD

Written 2026-10-28 by the ECC `architect` agent. Read-only design; it is not built yet.

**Inputs:**
- CLAUDE.md, PLAN.md (Phases 4-9, Amendment A)
- docs/architecture.md, docs/network-plan.md
- docs/product/FINAL-PRD.md, docs/product/FINAL-BUSINESS.md §6-8
- docs/audit/2026-10-28-web-notes.md
- packages/db schema and migrations up to 0006, .dependency-cruiser.cjs
- the engine and agent public APIs

**Baseline today:**
- **engine:** salary, requirements, skills, places, classifiers and dedup. No match, questions, replies or picks.
- **agent:** `llm/` only, with modes `anthropic | fixture | off`.
- **worker:** heartbeat, ingest, enrich and company tasks. No `embed:*`; `jobs.embedding` is empty.
- **db:** no user tables and no RLS policy anywhere.
- **fresher flag:** none. `jobs.llm_eligibility` is the LLM-fallback flag, not fresher eligibility.

## 1. HLD

```
 TB1 ─ untrusted internet ────────────────────────────────────────────────────────────────
 [Phone browser / PWA]  ──user gesture──►  [Employer ATS form]   (Hirelane never POSTs here)
   │ HTTPS, __Host-hl_session, same-origin server actions
 ══╪═══════════════════════════ TB2 ─ app tier ════════════════════════════════════════════
 ┌─▼──────────────────────── apps/web (Next 15) ─────────────────────────────────────────┐
 │ public board (built) │ lib/auth: Google OIDC+PKCE, email OTP, sessions │ app: onboarding,│
 │ /api/public (built)  │ lib/analytics: server-side events, HMAC(user)   │ picks/swipe,    │
 │ webhooks: inbound-email, payments (verify → persist → enqueue, withAdmin)│ check, handoff, │
 │                                                                          │ tracker, you    │
 └──┬ withUser (RLS) ───────────┬ addJob after commit ──────────────┬ vault.seal/open ────┘
 ═══╪══════════════════════════ TB3 ─ data plane (private) ═══════════════════════════════
 ┌──▼─────────── Postgres 16 + pgvector (:5433) ──────────┐   ┌ storage/ blobs ─────────┐
 │ public: jobs, companies, form_specs (SELECT, no RLS)    │   │ AES-256-GCM per-file DEK │
 │ user: profiles, resumes, picks, applications… (RLS)     │   │ (BlobStore: disk → S3)   │
 │ auth: sessions, otp_challenges (revoked from app role)  │   └──────────▲──────────────┘
 │ graphile_worker schema (owner only)                     │              │ HIRELANE_MASTER_KEY
 └──▲──────────────────────────────────────────────────────┘              │ (env secret only)
    │ withUser / withAdmin(allowlisted)                                    │
 ┌──┴──────────── workers/runner (graphile-worker) ─────────────────────────┴──────────────┐
 │ resume:parse  embed:*  match:*  picks:*  agent:draft  application:*  mail:*  notify:*     │
 └──┬─────────────────────┬──────────────────┬───────────────────┬───────────────────────────┘
 ═══╪═════════════════════╪══════════════════╪═══════════════════╪═ TB4 ─ egress (3rd party) ═
  agent/llm gateway      Mail provider        WhatsApp Cloud API    Web Push / PostHog
  (consent-gated,        (outbound + inbound  (opt-in, R2, verify)  (no PII; HMAC ids)
  redacted, cost-capped)  webhook, verify)    ATS public read APIs (ingest only)
```

### Ownership
Existing rules hold. New items are marked +.

| Package | Owns for the core loop |
|---|---|
| `engine` | + `match.ts`, + `worthwhile.ts` (the A8 gate), + `fresher.ts` (A4), + `questions.ts`, + `application-fsm.ts` (a pure transition table), + `replies.ts`, + `network.ts` (later). All pure, with a Trace and `now` injected |
| `db` | Schema, migrations, `withUser`/`withAdmin`, `addJob`, session and OTP row helpers (SQL and hashing only) |
| + `vault` | Envelope crypto (`seal`/`open`/`hmac`), `BlobStore`, key re-wrap. Imports no workspace package |
| `ingest` | + `forms/`: FormSpec discovery from public ATS read endpoints |
| `agent` | `llm/` + `gateway.ts` (consent check, redaction, per-user daily cap), + `resume/` (unpdf with rules; LLM only with consent), + `draft/`, + `applications/` (applies FSM transitions under `withUser`), + `handoff/` (the payload and a per-ATS capability registry), + `mail/` |
| `workers/runner` | All the tasks in §2.3 |
| `apps/web` | UI, server actions, `lib/auth`, `lib/analytics` |
| + `network` | Later (Amendment A): contacts import and edges |

### Dependency-cruiser edits
- `agent-engine-db` becomes `^packages/(?!agent|engine|db|vault)`.
- Add **`vault-is-leaf`**: vault must not import any other `packages/*`, `apps/` or `workers/`.
- `web-boundaries` is unchanged; it already allows vault.
- Add **`network-deps`**: engine, db and vault only.
- Add **`submit-is-isolated`** and **`nothing-imports-apps`**, which architecture.md §2.2 already called for.
- Add **`withadmin-allowlist`**, as a guard script or a dep-cruiser rule on the `withAdmin` import:
  - **Allowed callers:** `apps/web/app/api/public/**`, `apps/web/app/jobs/**`, `apps/web/app/api/webhooks/**`, `apps/web/lib/auth/**`, `apps/web/app/ops/**`, `workers/**` and `packages/ingest/**`.
  - **Why:** `apps/web/app/jobs/actions.ts` already uses `withAdmin`. Once FORCE is dropped, the owner role reads across users, so this rule is what keeps user routes on `withUser`.

## 2. LLD

### 2.1 Tables
Migrations start at **0007**, because 0005 and 0006 are taken.

**RLS key:**
- **own:** `ENABLE RLS` with the policy `user_id = current_setting('hirelane.user_id')::uuid` for `hirelane_app`.
- **rev:** revoked from the app role.
- **pub:** SELECT granted, no RLS.
- **ins-only:** the app role gets INSERT and SELECT only.

| Mig | Table | Key columns | Keys / indexes | RLS | Encrypted |
|---|---|---|---|---|---|
| 0007 | `users` | id, email citext, email_verified_at, display_name, phone_hmac, phone_enc, reply_handle, role, deleted_at | UQ(email), UQ(phone_hmac), UQ(reply_handle) | own (`id = …`), SELECT/UPDATE | phone_enc |
| 0007 | `auth_identities` | user_id, provider (`google`/`email_otp`/`phone_otp`), subject (Google `sub`, or an HMAC of the email or phone), verified_at | UQ(provider, subject) | rev | none (sub or HMAC) |
| 0007 | `sessions` | id_hash (sha256 of the token), user_id, expires_at, last_seen_at, revoked_at, ua_hash | pk id_hash; (user_id) | rev | none |
| 0007 | `otp_challenges` | id, channel, target_hmac, code_hash, attempts ≤5, expires_at (+10 min), consumed_at, ip_hash | (target_hmac, created_at) | rev | none |
| 0007 | `consents` | id, user_id, kind (`terms`/`privacy`/`llm_resume`/`llm_contacts`/`whatsapp`/`email_picks`/`analytics`), granted, doc_version, at | append-only; (user_id, kind, at desc) | own, ins-only | none |
| 0008 | `profiles` | user_id pk, grad_year, degree, college_text, role_families[], cities[], remote_ok, level, floor_minor/currency, tz default `Asia/Kolkata`, picks_hour default 9, paused_until | | own | college_text |
| 0008 | `work_authorizations` | as in PLAN | PK(user_id, country) | own | none |
| 0008 | `answer_bank` | user_id, question_key, answer_enc, sensitive, source | UQ(user_id, question_key) | own | answer_enc |
| 0008 | `resumes` | id, user_id, parent_id, label, blob_key, dek_wrapped, mime (PDF only), pages, parsed_enc, skills[], years_exp, embedding vector(384), embedding_model, parse_mode (`rules`/`llm`), parse_status, confirmed_at, is_default, deleted_at | UQ(user_id) WHERE is_default; at most 3 active (trigger) | own | blob, parsed_enc. skills[] stays in the clear because matching needs it |
| 0009 | `user_job_matches` | as in PLAN; the trace stores **offsets into the resume, never quotes** | PK(user_id, job_id, resume_id) | own | none |
| 0009 | `daily_picks` | user_id, pick_date (IST date), rank, job_id, score, worthwhile jsonb (the A8 conditions), state (`pending`/`right`/`left`/`saved`/`expired`) | PK(user_id, pick_date, rank); UQ(user_id, job_id) | own | none |
| 0009 | `job_decisions` (replaces `job_passes`) | user_id, job_id (canonical), decision (`right`/`left`/`save`), skip_reason (`city`/`role`/`too_senior`/`pay`/`other`), surface, at, undone_at | PK(user_id, job_id) | own | none |
| 0010 | `applications` | PLAN columns + handoff_mode (`copy`/`prefill`/`extension`), submit_answer (`yes`/`not_yet`/`couldnt`), couldnt_reason, use_alias default false | UQ(user_id, job_id), UQ(reply_token) | own | none (snapshots are public job data) |
| 0010 | `application_answers` | PLAN columns; **every answer stored as answer_enc**; evidence stored as offsets | (application_id, ord) | own | answer_enc |
| 0010 | `application_events` | PLAN types + `submitted`, `couldnt`, `receipt` | (application_id, at) | own, ins-only (no UPDATE or DELETE) | the payload never holds answer text |
| 0010 | `handoff_receipts` | application_id pk, user_id, answers_sha256, resume_id, fields_total, needs_you_cleared, prepared_at, confirmed_at | | own, ins-only | none (hash only) |
| 0010 | `idempotency_keys`, `usage_ledger` | as in PLAN; `period_key` is the ISO week in IST | PK(user_id, key); UQ(application_id, kind) | own | none |
| 0010 | `form_specs` | as in PLAN | PK(posting_id) | pub | none |
| 0011 | `inbound_messages` | as in PLAN | UQ(provider_message_id) | own | blob, text_excerpt |
| 0011 | `outbound_messages` (generalised) | user_id, channel (`email`/`whatsapp`/`push`), kind, dedupe_key, status, scheduled_for, sent_at, provider_ref | UQ(dedupe_key) | own | none (bodies are rendered at send time) |
| 0011 | `notification_prefs`, `push_subscriptions` | enabled per channel × kind, quiet hours; endpoint_enc, keys_enc | | own | endpoint, keys |

### 2.2 Server actions and routes
Every action runs inside `withUser` with an origin check. Every mutation takes an `Idempotency-Key`.

| Step | Actions / routes |
|---|---|
| Account | `startGoogle` → `/auth/google/callback`; `sendEmailCode(email)`; `verifyEmailCode(email, code)`; `logout`; `recordConsent(kind, granted)`; `DELETE /api/me`; `GET /api/me/export` |
| Resume | `POST /api/resumes` (multipart, PDF ≤5 MB, magic bytes; web seals it with vault and enqueues the parse); `confirmParse(resumeId, edits)` creates a new version; `GET /api/resumes/{id}/file` (audited) |
| Profile | `savePreferences`, `saveWorkAuth` |
| Picks | `getTodayPicks()` reads `daily_picks`; `refreshPicks()` is rate-limited |
| Swipe | `swipe(jobId, dir, reason?)`; `undoSwipe(jobId)` within 4s; `swipeRight` creates the application and enqueues `agent:draft` |
| Fill / check | `getApplication(id)`; `answerField(id, answerId, value, remember)`; `swapResume(id, resumeId)` |
| Hand-off | `approve(id)` returns undoUntil; `undo(id)`; `commit(id)` returns `{applyUrl, prefillUrl?, fields[], replyAddress?, resumeUrl}`; `confirmSubmit(id, yes\|not_yet\|couldnt, reason?)` |
| Tracker | `listApplications(state?)`; `moveApplication(id, to)`; `withdraw(id)`; `POST /api/webhooks/inbound-email` |

### 2.3 Worker tasks
| Task | Trigger | jobKey / idempotency | Context |
|---|---|---|---|
| `mail:send` | OTP, nudges | `mail:{outbound_id}`; UQ(dedupe_key) | admin for OTP, user otherwise |
| `resume:parse` | upload | `resume:parse:{resumeId}`; does nothing unless parse_status = pending | user; LLM only with `llm_resume` consent |
| `embed:job` (backfill, and per enrich) / `embed:resume` | enrich finalize / parse confirm | `embed:{kind}:{id}:{model}`; skipped if embedding_model already matches | admin / user |
| `match:user-full` | resume confirmed, preferences changed | `match:user:{userId}`, mode `replace` | user |
| `match:user-delta` | enrich finalize | `match:delta:{userId}:{runId}` | user |
| `picks:tick` | cron `0 * * * *` | singleton; selects users whose local hour is picks_hour − 1 | admin, read-only selector |
| `picks:user` | tick, end of onboarding | `picks:{userId}:{istDate}`; ON CONFLICT DO NOTHING | user |
| `agent:draft` | swipe right, resume swap | `draft:{applicationId}`; runs only from `drafting` | user |
| `form:spec` | first draft for a posting | `form:{postingId}`; refreshed after 7 days | admin (ingest) |
| `application:commit-expired` | cron, every minute | singleton; `UPDATE … WHERE status='approved' AND undo_until < now()` | admin, allowlisted |
| `application:confirm-nudge` | handed_off + 2h / + 24h | `nudge:{appId}:{n}` | user |
| `mail:inbound` → `mail:forward` | webhook | `mail:in:{provider_message_id}` | admin, then user |
| `notify:dispatch` | an outbound row falls due | `notify:{outbound_id}` | user |

### 2.4 Application state machine
This merges the PRD and PLAN names. The UI label for `rejected` is "not this time".

| From → To | Trigger | Actor | Guard |
|---|---|---|---|
| ∅ → drafting | swipe right | user | UQ(user, job); the job is open |
| drafting → needs_you / ready | `agent:draft` finishes | system | any field marked needs_you sends it to needs_you |
| needs_you ↔ ready | answer filled or cleared, resume swapped | user | |
| ready → approved | Approve | user | no needs_you left; quota checked but not consumed |
| approved → ready | Undo | user | server-side `now() < undo_until` |
| approved → handed_off | `commit` (the client at 4s, or the sweep) | user/system | consumes `usage_ledger` once per application lifetime; writes the receipt |
| handed_off → submitted | "Yes, I submitted", or an inbound `ack` that passes DKIM and SPF | user / inbound | |
| handed_off → ready | "Couldn't" plus a reason | user | handing off again does not consume a second time |
| submitted → replied / interview / rejected | a classified reply (DKIM pass) or a kanban move | inbound / user | an SPF or DKIM failure never moves the state |
| replied → interview → offer | move | user | `offer` only when the user confirms it |
| pre-handoff → expired | the job closed | system | |
| any non-terminal → withdrawn | user | user | |

### 2.5 Sequence: swipe right → tracker
```mermaid
sequenceDiagram
  actor U as User (phone)
  participant W as apps/web
  participant DB as Postgres (RLS)
  participant Q as worker
  participant E as Employer form
  U->>W: swipe right (Idempotency-Key)
  W->>DB: withUser: job_decisions, applications(drafting), event drafted
  W->>Q: addJob agent:draft (after commit)
  W-->>U: /apply/{id} "preparing"
  Q->>DB: withUser: load form_spec, profile, answer_bank, resume (vault.open)
  Q->>Q: engine.questions → deterministic fill → validator → Needs-you
  Q->>DB: answers (encrypted), state ready|needs_you
  U->>W: fill Needs-you, Approve
  W->>DB: approved, undo_until=now()+4s
  W-->>U: 4s draining bar (Undo possible)
  U->>W: commit at 4s (or sweep commits)
  W->>DB: handed_off, usage_ledger consume, handoff_receipts
  W-->>U: copy pack + resume download + "Open {company} form" button
  U->>E: fresh tap opens form; user pastes and presses Submit
  U->>W: returns (visibilitychange) → "Did you submit? Yes"
  W->>DB: submitted, event; tracker shows lane + receipt
```

The second tap is required. After a 4-second timer, `window.open` no longer counts as a user gesture, so popup blockers stop it.

## 3. Auth for Indian freshers
| Option | Pros | Cons |
|---|---|---|
| Google OIDC | Free. Nearly every Android user has a Google account (verify). It gives a verified email, which reply forwarding needs | Google blocks OAuth in embedded webviews such as the Instagram and WhatsApp in-app browsers (`disallowed_useragent`, verify). Those are exactly where the recap and WhatsApp links land |
| Phone OTP (SMS) | Indian habit; the number can be reused for WhatsApp | Cost per SMS (verify). DLT sender and template registration take time (verify). Open to SMS-pumping and OTP-bombing abuse. Still no email for replies |
| Email magic link | Free | Breaks across browsers when opened outside the in-app browser; freshers check email less |
| Email 6-digit code | Free; works in any webview; gives a verified email | Deliverability to college domains; one extra field |

**R1 recommendation:**
- Google as the primary sign-in, with a 6-digit email code as the fallback that covers in-app browsers.
- Our own opaque sessions as PLAN specifies, not Auth.js. RLS and the `__Host-` cookies are already designed, and an adapter would add a second user model.
- Phone OTP waits for R2, bundled with the WhatsApp opt-in.
- Needs a PRD B1 amendment.

## 4. Legal fill and hand-off, with no auto-submit
| Option | Works on a phone | Actually "filled" | Legal / ToS posture | Verdict |
|---|---|---|---|---|
| Prefill deep link | yes | partly; it can't attach the resume | Clean, but per-ATS support is unknown (verify). PII in the URL ends up in employer logs | Per ATS, after a dated verification, non-sensitive fields only |
| Copy pack / clipboard | yes | no: one-tap copy per field, a "copy next" stepper, the resume PDF downloaded for the file picker | cleanest | **R1 default** |
| Browser extension (MV3) | no (Android Chrome has no extensions, verify) | yes; the user clicks Submit | same as Simplify; a guard enforces "never clicks submit" | **R2, for laptops** |
| Headless, then hand-off | n/a | can't move the filled DOM into the user's browser | violates the MVP rule and `no-submit-guard` | **Reject** |

**Receipt:** an honest version of Tsenta's. It records what Hirelane prepared (an answers hash, the resume version, a timestamp) and what the user confirmed. It never claims to show what was submitted.

**CTA rule:** "Open <company>'s form, filled" appears only when `handoff_mode ∈ {prefill, extension}`. Otherwise the CTA reads "Open <company>'s form · answers ready to copy" (H1).

## 5. Gaps to resolve before building
| # | Conflict | Resolution | Blocks the slice |
|---|---|---|---|
| 1 | FORCE RLS vs `withAdmin` running as a non-superuser owner; no `GRANT hirelane_app TO current_user` | **Decided 2026-10-28:** drop FORCE, keep ENABLE; `hirelane_app` owns nothing; add the `withadmin-allowlist` guard; `verify-rls` runs as a non-superuser | Y (M0) |
| 2 | Auth: PLAN has scrypt passwords; PRD B1 has phone OTP or Google | **Decided:** Google plus an email code, in `apps/web/lib/auth` | Y (M1) |
| 3 | Resume to LLM: PLAN 4.4 uses Sonnet by default; CLAUDE.md and PRD B3 require consent | Parse with rules first; use the LLM only with `llm_resume` consent; amend PLAN 4.4 | Y (M2) |
| 4 | B6 needs a privacy page, terms and a grievance officer before any upload | The pages ship with a placeholder; **upload stays behind the `accounts` flag until the owner names the officer** | Y (M2) |
| 5 | PRD A8 "worthwhile" vs the PLAN §3.4 score; there is no A4 fresher flag | The score stays about fit; A8 is a separate pure gate (`engine/worthwhile.ts`) applied before ranking; `engine/fresher.ts` comes from the level classifier plus spans like "0–2 yrs / fresher / new grad" | Y (M3) |
| 6 | Embeddings are empty and there is no `embed:*` task | `embed:job` backfill with the `hash` provider in M3; don't zero the S term | Y (M3) |
| 7 | State names differ between PLAN and the PRD | Use the §2.4 set | Y (M5) |
| 8 | The "Open form, filled" CTA vs prefill `none` | the §4 CTA rule | Y (M6) |
| 9 | PLAN allows unlimited triage; the PRD has at most 5 daily picks | `daily_picks` holds at most 5 and says so honestly; Discover shows the rest | N |
| 10 | Pricing differs between PLAN and the PRD | The PRD wins: `period_key` is the IST week; the paywall shows at check and is enforced at commit | N |
| 11 | PLAN §4 bans rings and uses A/P/U keys; the PRD uses Wrapped | Amend PLAN §4 to point at the mocks | N |
| 12 | LLM config drift: modes, model defaults, the ₹0.3 cap | Make the env and docs match the code; the slice fill makes 0 LLM calls | N |
| 13 | Timing for network, autopilot and tailoring | **Decided:** all after the slice | N |
| 14 | Migration numbering, IA, reply-alias default, DOCX | Start at 0007; PRD tabs; the alias is opt-in, default off; PDF only | N |
| 15 | Roster: PLAN says tdd-guide does UI | CLAUDE.md wins: the main session does UI | N |

## 6. Build order: the smallest real-user slice
| M | Deliverable | Unblocks |
|---|---|---|
| D (parallel) | Deploy target, Google OAuth client, real mail sender (verify), CI with `pnpm verify`, `TZ=UTC`, pino redaction | real users |
| M0 | Migration grant; `packages/vault` + `LocalBlobStore`; dep-cruiser edits; a real `verify-rls` harness | every PII table |
| M1 | 0007 auth tables, Google + email code, sessions, `consents`; privacy, terms and grievance pages; the "What Hirelane never does" card | anything per-user |
| M2 | 0008 profiles and resumes; sealed PDF upload; `resume:parse` with rules only; inline fixes to the parse; preferences and work authorisation | matching |
| M3 | `embed:job` backfill (hash); `engine/match.ts`, `fresher.ts`, `worthwhile.ts` (TDD); `match:user-full`; `picks:user` run immediately at the end of onboarding, then by cron | swipe |
| M4 | 0009; swipe deck with a button for every gesture; skip reasons; save; 4s undo | fill |
| M5 | 0010; `engine/questions.ts`; GH/Lever/Ashby FormSpecs; deterministic `agent:draft`; Needs-you; the check screen; remember-answer | hand-off |
| M6 | approve/undo/commit, idempotency, receipt, copy pack, audited resume download, open-form button, "Did you submit?", confirm-nudge email, free counter | tracker |
| M7 | Tracker list and lane timeline, manual moves, "Gone" for closed jobs. **The slice is done:** e2e runs signup → tracker with 0 ATS requests and 0 LLM calls | pilot |
| Later | inbound replies (0011), email picks digest, consented LLM free-text, push and WhatsApp (verify), passes, network, extension | R1/R2 |

**Supply risk:** gate G0 fails today (75 India entry roles). M3 must show honest pick counts. Board discovery (A5) has to run in parallel.
