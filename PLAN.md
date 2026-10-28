# Hirelane: PLAN.md

> Status: approved for build. Written 2026-10-15.
> The only sources are the recon files (Shortlist teardown, page text, llms.txt, API sample, screenshots, all captured 2026-10-15) and the house conventions of `/Users/aagarwal/solum`.
> Every claim below carries a tag:
> - `[verified]` means checked directly against a recon file or the solum repo.
> - `[relayed]` means it is Shortlist's own marketing claim and has not been checked.
> - `[assumption]` means our inference. If a calculation or contract depends on an `[assumption]`, that is a **task with an owner**, not a footnote.

---

## 1. Product summary

Hirelane has two parts, and they share one database.

1. **A public job board.** Roles are read only from public ATS board APIs: Greenhouse boards-api, Lever v0 postings and Ashby posting-api. The board is refreshed every 6 hours, and closed roles are soft-closed.
   - Every posting is enriched with:
     - a normalised annual salary that shows how it was derived
     - structured must-have and nice-to-have requirements
     - skills
     - countries
     - level, workplace and visa
     - a canonical company entity
   - The board can be read by anyone: humans, search crawlers (through the sitemap and SEO list pages) and AI agents (through `llms.txt`, the public JSON API and `Accept: text/markdown`).

2. **An AI job-application agent.** The loop works like this:
   1. Upload a resume once.
   2. Get ranked matches, each with an **explained** hybrid score whose maths is shown.
   3. Triage one card at a time: apply or pass. A pass hides the job forever.
   4. The agent drafts every answer, shows the full form, and flags **Needs you** on anything it must not guess (visa, start date, salary, EEO).
   5. You approve, and you have a 4-second undo.
   6. **Handoff.** Hirelane opens the employer's real application URL, beside a copy-answers panel (with URL prefill only where an ATS has been verified to support it).
   7. Replies come back to a per-application reply address and are threaded onto the application in a kanban tracker.
   - Autopilot runs a rule (minimum score, my role only, N per day). It **drafts and queues** applications and sends a batch digest. **It never sends.** In the MVP, nothing is ever submitted to an employer by Hirelane.

**India-first pricing.**
- Free: 10 applications.
- Paid: weekly and monthly plans, priced in INR (Razorpay) or USD (Stripe). Both providers are stubs behind one interface.

**Point of difference.** We keep Shortlist's mechanics and drop its template look. We add depth in four places:
- salary normalisation and coverage
- canonical companies and dedup
- transparent matching
- resume versions with tailoring, a tracker, and observability

---

## 2. What we keep

These are the mechanics that work in Shortlist and that we replicate. All observations are `[verified]` from the recon files unless tagged.

| Mechanic | Shortlist behaviour | Hirelane implementation |
|---|---|---|
| Public board | Search plus filters: role, country, remote, salary-only, workplace, employment, level, visa, posted-within | Same filter set and parameter names on `/jobs` and `/api/public/jobs`, plus a minimum annual pay filter with an INR/USD toggle |
| Job page | Parsed salary, skills, freshness, employer apply link | The same, plus the salary derivation trace, the requirements split into must-have and nice-to-have, the company entity, and the source boards |
| Explained score | "9 of 11 requirements matched, salary above your $80k floor, Kubernetes not on your resume" | The full equation is shown term by term, with resume evidence spans (see §3.4) |
| One-at-a-time triage | Apply or pass; a pass is gone forever | `/triage` docket, keyboard-first (A / P / U). The pass is stored on the **canonical** job, so a re-post on another board stays hidden |
| Approval preview | Full form, which resume, which email, Needs-you flags | The same, and approval is blocked while any Needs-you field is unfilled |
| 4-second undo | Undo any send | Undo any approval for 4 seconds. The server is authoritative (see §5 and Phase 5) |
| Autopilot | Minimum score, my role only, N per day, batch email with a pause link | The same rule shape. In the MVP it **drafts**; it never sends |
| Reply threading | Per-user address; replies filed on the application and forwarded | Per-user and per-application plus-address token, an inbound webhook (stub adapter), forwarding, soft-filed rejections |
| Never apply twice | Idempotent sends | `UNIQUE(user_id, canonical_job_id)`, plus an `Idempotency-Key` on the approve and commit calls |
| India-first pricing | Free 10, no card; weekly/monthly/quarterly; UPI or card; USD outside India | Free 10; weekly and monthly; INR through Razorpay (UPI and card), USD through Stripe. Both stubbed in dev |
| Agent-native distribution | `llms.txt`, `Accept: text/markdown` on job pages, public JSON API, sitemap, SEO list pages | All of these, plus an OpenAPI document and a public `/status` freshness page |
| Honest limits copy | "Missing salary means not stated, never unpaid" | We keep that rule in the engine: an unparsed salary is `null` and is **never** estimated |
| Never fabricate | "It asks instead of guessing" | Enforced in code: a drafted answer without a resume evidence span becomes Needs you (`low_confidence`) |

---

## 3. What we add (depth)

### 3.1 Salary normalisation and coverage
- **Precedence of sources:**
  1. Structured compensation from the ATS. Ashby `includeCompensation=true` is `[verified]` as an endpoint parameter in the recon notes. The Lever `salaryRange` and Greenhouse pay fields are `[assumption]`; confirm them against the recorded fixture in Phase 1.
  2. A deterministic text parser.
  3. A Haiku extraction for low-confidence cases. Its output is accepted **only** if every number it returns appears verbatim in the posting text.
- **The parser handles:**
  - Currency: symbols ($ £ € ₹), ISO codes, "Rs.", "INR". An ambiguous `$` is resolved through the location country to USD, CAD, AUD or SGD.
  - Number formats:
    - Indian grouping, as in `1,20,000`
    - EU grouping, as in `60.000`
    - `120k` and `1.2M`
    - `LPA`, `lakh`, `crore` and `CTC`
  - Periods, converted to annual:
    - hourly × 2080
    - daily × 260
    - weekly × 52
    - monthly × 12
  - Ranges: "up to" and "from" expressions.
  - Pay labels:
    - OTE is flagged separately from base pay.
    - Equity is ignored.
  - False positives it must reject, using context-window rules:
    - "401k"
    - "$100M Series B"
    - years of experience
    - team size
- **Storage:** money is integer minor units (paise or cents) plus an ISO 4217 code, never floats (solum convention). Annual USD and INR equivalents use a dated `fx_rates` snapshot, and the snapshot date is shown in the UI.
- **Coverage target:** the recon numbers disagree. They say 39% on the board, 45% in llms.txt, and "~60% not stated" in the notes. So the target is set on **parser quality** first:
  - precision ≥ 0.98
  - recall ≥ 0.95 against postings that state a salary anywhere, measured on a labelled set of ≥ 300 snippets
  - headline coverage ≥ 50% on the recorded corpus `[assumption: depends on the board mix; the board list is weighted toward pay-transparency jurisdictions]`
- `pnpm report:coverage` reports both the headline coverage and the "salary stated anywhere" ceiling, so the gap is attributable.

### 3.2 Canonical company entities
- `companies` holds the proper display name, domain, slug and logo. "OpenAI" is shown, not the board token "openai".
- **Logos:**
  - Fetched at ingest from the company's **own configured domain**: `<link rel=icon|apple-touch-icon>`, falling back to `/favicon.ico`.
  - Re-encoded to PNG with sharp and cached under `storage/logos/`.
  - Fixture copies are committed so dev works offline.
  - Fallback: an original two-letter monogram stamp drawn in a ruled box.
  - We do not use Clearbit or any third-party logo API.
- `/company/[slug]` shows open roles, source boards, freshness, and the median posted pay where n ≥ 5.

### 3.3 Dedup across boards and locations
- Postings, one per board entry, cluster into **canonical jobs** when all three hold:
  - same `company_id`
  - equal normalised title
  - simhash64 of the description within Hamming distance ≤ 3
- Locations are merged. The primary posting is the one with the earliest `first_seen_at`.
- Passes, applications, matches and never-apply-twice all key on the canonical job.

### 3.4 Requirement extraction and transparent hybrid matching
- **Requirement extraction:**
  - Section detection covers "Requirements", "Qualifications", "What you'll bring", "Must have", "Nice to have", "Bonus" and "Preferred".
  - Bullets are split, then classified as `must` or `nice`.
  - Each requirement gets a category (skill, experience, education, language, location, authorization, other), its minimum years, its linked skill ids, and **evidence offsets** into the description.
- **Score formula (engine v1).** Every term is recorded as a `CalculationStep` in a `Trace`, the solum pattern, and the UI renders that trace. That is the "math shown".

```
score = round(100 × G × (0.55·C + 0.30·S + 0.15·F))

C  requirement coverage = Σ wᵢ·mᵢ / Σ wᵢ
     wᵢ = 2 for must-have, 1 for nice-to-have
     mᵢ = 1 when the resume has the skill (evidence span)
        = 0.5 when only an adjacent skill matches (taxonomy, e.g. Docker → Kubernetes)
        = 0 otherwise
S  semantic similarity = clamp((cos(resume_vec, job_vec) − 0.20) / 0.60, 0, 1)
     constants calibrated on a fixture set in Phase 4
F  fit = mean(level_fit, salary_fit)
     level_fit:  1 for the same level, 0.5 for one step away, 0 otherwise
     salary_fit: 1 when the job max ≥ your floor, 0.5 when unknown, 0 when below
G  eligibility gate ∈ {0, 1}
     authorised in a job country, OR remote in an allowed country, OR visa sponsorship = yes
     AND no dealbreaker hit
     G = 0 hides the job and gives the reason ("Requires US work authorisation")
```

- **Display:** "82 · 9 of 11 requirements (7/8 must, 2/3 nice) · pay above your ₹30L floor · missing: Kubernetes (adjacent: Docker)".
- **The salary floor only filters your feed.** It is never shown to employers.

### 3.5 Resume versions and per-job tailoring
- Resumes are immutable versions with `parent_id`, for example "v3 · TypeScript-first". An edit creates a new version.
- **Tailoring:**
  - For a specific job, the agent proposes reordering and rewording bullets toward the matched requirements, shown as a word-level diff.
  - A validator rejects any skill, employer, date or metric that is not in the base version.
  - Accepting the diff creates a child version, which is rendered to PDF by the worker.

### 3.6 Application tracker
- The kanban columns are Drafted → Sent → Replied → Interview → Offer / Rejected.
- Each application has a "lane" timeline built from `application_events`.
- Replies are threaded onto the application. Snapshots of the job, its requirements, the match and the answers are stored on the application, so it outlives the job closing.

### 3.7 Observability
- **Ingest stats:** an `ingest_runs` row per run, and an `ingest_source_runs` row per board per run. Each source row holds HTTP status, counts (new, changed, unchanged, closed), bytes, duration and error.
- **Freshness SLA:** 95% of open jobs have `last_seen_at` within 7 hours, and a closure is detected within 13 hours.
- **Fetch error budget:** per-source fetch success SLO of 99% over 7 days.
- **Pages:** `/ops`, `/ops/sources/[id]` and `/ops/slo` show error-budget burn, queue lag and LLM spend. Public `/status` shows freshness only.

---

## 4. Banned UI tropes + our UI direction

### 4.1 Banned
These are observed in `shots/sl-home-desktop.png`, `sl-jobs.png` and `sl-how.png`, or named by the user. **None of them may ship.** Design review rejects a PR that contains any of them.

1. An orange-on-cream palette, or any warm saturated accent on a beige page.
2. Mascots, emoji characters, or an anthropomorphised agent with a first name. The agent is "Hirelane", and copy says "drafted from your resume".
3. Phone or device mockups in the hero.
4. A stats band: big numbers in a dark strip such as "15,000+ / 250+ / 0 / 4s".
5. A three-card "old way" grid with line icons.
6. A testimonial row with star ratings and initials avatars.
7. An all-caps coloured eyebrow label above every heading.
8. Giant faded step numerals (01 / 02 / 03).
9. Glowing or gradient pill CTAs.
10. Floating notification chips orbiting a mockup ("Interview booked", "Reply from Sarah").
11. A full-bleed coloured CTA band above the footer.
12. FAQ accordion stacks.
13. A centred H2 plus grey subtitle opening every section.
14. A uniform 4-column card grid with letter avatars and a "New · just now" pill on every card. When everything is new, nothing is.
15. Check-mark bullet feature lists.
16. Donut or ring score gauges.
17. Decorative blobs or quarter-circles.
18. A mega-footer with six columns of SEO links. SEO lists live on `/lists`, and the footer is one line.
19. Social-proof counters that are not computed live from the database with an as-of date.

### 4.2 Direction: "the timetable"
**Point of view.** A job search is logistics, not a lottery. The interface reads like a well-set timetable or dispatch ledger: dense, ruled, aligned, and every figure sourced. **Colour reports state; it never decorates.** This POV is written as the header comment of `apps/web/app/globals.css` (solum convention) and implemented as Tailwind v4 `@theme` tokens.

- **Typography: one family, road signage.** (Revised 2026-10-16: the original Instrument Serif + IBM Plex Mono pairing is the
  generic AI-generated look the owner rejected.) **Overpass** (OFL; a libre take on Highway Gothic, the US road-sign face), installed
  from `@fontsource-variable/overpass` so builds work offline, wired through `next/font/local`.
  - *Display:* Overpass 800, tracking −0.025em, 40 / 56px, for page titles, the wordmark and the pay figure on a job page.
  - *Text and UI:* Overpass 400/500/600, 15px base, 1.5 line-height.
  - *Figures:* the same face with `font-variant-numeric: tabular-nums` for every salary, score, count and timestamp. **No monospace
    face anywhere.** Source codes (`gh` / `lv` / `ab`) become small sign-shaped badges, not mono text.
  - Labels are sentence case, never all caps.
- **Palette (light; dark mode is deferred).**

  | Token | Hex | Use |
  |---|---|---|
  | `--paper` | `#F3F4F1` | Page background: a cool green-grey, not cream |
  | `--sheet` | `#FFFFFF` | Raised surfaces |
  | `--rule` | `#D5D9D3` | Hairlines |
  | `--rule-strong` | `#A9B0A8` | Section rules |
  | `--ink` | `#17302A` | Primary text: dark highway green, a real colour rather than tinted black |
  | `--ink-2` | `#4A524D` | Secondary text |
  | `--ink-3` | `#7C847E` | Tertiary text, stale timestamps |
  | `--lane` | `#1B4D3E` | Primary action, matched requirement, active state |
  | `--lane-soft` | `#E3ECE7` | Matched-row tint |
  | `--signal` | `#F2C230` | **Only** for Needs you and the undo countdown (always with ink text) |
  | `--stop` | `#A3261B` | Missing requirement, ineligible, error |
  | `--stop-soft` | `#F6E3E0` | Error tint |

- **Grid:**
  - 12 columns, maximum width 1320px, 24px gutters, 32px outer margins (16px on mobile), 4px baseline.
  - Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 72.
  - App pages use a 248px filter rail plus a fluid ledger.
  - The job page splits 8 / 4: the description held to a ≤ 72ch measure, and a ledger sidebar holding pay trace, requirements, freshness and Apply.
- **The board is a ledger, not cards.**
  - Columns: `Fresh` ("2h") · `Role` and company (16px logo) · `Where` (ISO codes plus workplace) · `Pay` (normalised annual, original string beneath) · `Match` (signed-in only: "82 · 9/11") · `Source` (sign badge `gh` / `lv` / `ab`).
  - Rows are 44px. On mobile they collapse to a two-line stacked row.
  - Keys: `/` to search, `j` / `k` to move, `Enter` to open.
- **Signature components:**
  - **Lane timeline:** an application drawn as a road lane with dashed markings, exits as stages (drafted, approved, handed off, sent, replied, interview, outcome) and tabular timestamps.
  - **Match ledger:** the score written as its equation. Each requirement row expands to show the resume evidence span.
  - **Docket (triage):** a single ruled sheet. A pass slides out 160ms and is gone.
  - **Needs-you field:** a 4px `--signal` left rule (a lane marking) plus a short reason label.
  - **Undo bar:** a 4px `--signal` bar draining linearly over 4000ms at the top of the sheet, plus a tabular countdown "3.2s". `U` or `Esc` undoes.
- **Motion:**
  - 120ms ease-out for hover and state changes.
  - 160ms `cubic-bezier(.4,0,1,1)` for the triage exit.
  - 200ms `cubic-bezier(0,0,.2,1)` for panel open.
  - 4000ms linear for the undo bar.
  - **None of:** scroll-triggered reveals, parallax, springs or bounce, skeleton shimmer.
  - Under `prefers-reduced-motion: reduce`, all transforms are removed, opacity transitions are capped at 80ms, and the undo is shown as a numeric countdown only.
- **Landing page:**
  - The H1 is one sentence in Overpass 800.
  - The hero is **the live ledger of the 12 freshest jobs**, server-rendered from the database, captioned "refreshed 2h 14m ago from 97 boards" (live values).
  - Below it, "How it works" is a single real application preview, rendered with the actual preview component and fixture data, then the pricing table. Nothing else.
- **Brand:** a lowercase "hirelane" wordmark in Overpass 800, preceded by two short parallel rules (lane markings). The favicon is two `--lane` bars on `--paper`. The SVGs live in `apps/web/public/brand/`. There is no mascot.
- **Copy voice:** second person and plain. No exclamation marks, no "magic", no emoji. Limits are stated outright.

---

## 5. Architecture

### 5.1 Diagram

```
                Greenhouse boards-api   Lever v0 postings   Ashby posting-api
                          \                   |                    /
                           \     (live mode only; fixture mode reads gz fixtures)
                            v                 v                  v
  workers/runner  (@hirelane/worker, graphile-worker on Postgres)
   ├─ cron 7 */6 * * *  ingest:schedule ─► ingest:source (one per board) ─► ingest:finalize
   ├─ enrich:posting  ── @hirelane/engine (pure parse/classify/dedup) + @hirelane/agent/llm (Haiku fallback)
   ├─ company:logo, embed:job, embed:reindex
   ├─ match:user-delta / match:user-full ── @hirelane/engine/match
   ├─ autopilot:run ─► agent:draft ─► digest:send
   ├─ agent:parse-resume, resume:render (Playwright PDF)
   ├─ mail:inbound ─► mail:forward
   └─ ops:freshness (*/15), retention:purge (daily), application:commit-expired
                            │  withAdmin (ingest, ops)  ·  withUser (anything per-user, so RLS stays exercised)
                            v
  packages/db  ── Postgres 16 + pgvector (docker, host :5433)
     SQL migrations (numbered, checksum runner) · Drizzle schema + query builder · roles: owner / hirelane_app
                            ^
                            │  withUser(userId) → SET LOCAL ROLE hirelane_app + hirelane.user_id
  apps/web (Next.js 15 App Router, React 19, :3001)
   ├─ public: /, /jobs, /job/[slug] (+ text/markdown), /company/[slug], /lists/*, /pricing, llms.txt, sitemaps
   ├─ /api/public/*  (read-only JSON, CORS *, rate-limited)
   ├─ app: /triage, /applications, /resumes, /autopilot, /inbox, /settings, /billing  (server actions)
   ├─ webhooks: /api/webhooks/inbound-email, /razorpay, /stripe   ── enqueue only, never heavy work inline
   └─ /ops/* (admin role)
  User browser ── handoff ──► employer's real application URL (new tab, user gesture)  [Hirelane never POSTs to an ATS in the MVP]
```

### 5.2 Package boundaries
These mirror solum: `@hirelane/*` scope, `"type": "module"`, `main: ./src/index.ts` consumed from source, vite-node scripts, `pnpm@9.12.0`, `node >= 20`. Workspace globs are `packages/*`, `apps/*` and `workers/*`.

| Package | Owns | May import | Must not |
|---|---|---|---|
| `packages/engine` | Salary parse and normalise, skills taxonomy, requirements, classifiers (level, workplace, employment, countries, visa, role family), dedup keys, match score, autopilot rule evaluation, reply classifier rules, question classifier. Versioned `ENGINE_VERSION`; every result carries a `Trace` | nothing (zero runtime dependencies) | Network, DB, clock (`now` is injected), randomness |
| `packages/db` | `client.ts` (`withAdmin`, `withUser`, `close`), `migrate.ts` (checksum runner, refuses edited migrations), `reset`/`seed`, `verify-rls.ts`, `verify-auth.ts`, `verify-schema.ts` (Drizzle ↔ information_schema drift), `auth.ts` (scrypt plus opaque sessions), `queue.ts` (thin `addJob` wrapper over graphile-worker's `quickAddJob` so web never imports the worker), Drizzle schema in `src/schema/*.ts` | `pg`, `drizzle-orm` | Business logic |
| `packages/ingest` | Connectors (`greenhouse.ts`, `lever.ts`, `ashby.ts`) → `RawPosting`; recorder; `boards.json`; fixtures; posting persistence and diff | `db` | Enrichment, LLM |
| `packages/agent` | `llm/` (`AnthropicProvider`, `FixtureProvider`, `NullProvider`), `embeddings/` (`hash`, `local`), resume parsing, answer drafting, approval queue state machine, handoff payload plus per-ATS capabilities, tailoring, `mail/` (inbound adapter, mailer, templates), `submit/` (Phase 9 only, flagged) | `engine`, `db` | Any HTTP call to an ATS application endpoint outside `submit/` (enforced by `scripts/no-submit-guard.ts`) |
| `workers/runner` | graphile-worker tasks and crontab | all packages | UI |
| `apps/web` | Pages, server actions, route handlers; `lib/{queries,session,format}.ts` | `db`, `engine`, `agent` | `ingest`, `workers` |

Boundaries are enforced by `pnpm lint:deps` (dependency-cruiser, `.dependency-cruiser.cjs`).

**ORM decision.** Drizzle provides the typed schema and query builder. Migrations remain **hand-numbered SQL** in `packages/db/migrations/NNNN_*.sql`, applied by the solum-style checksum runner. `drizzle-kit push` and `drizzle-kit generate` are never used. `verify-schema.ts` fails the build on drift. pgvector columns use Drizzle `vector({ dimensions: 384 })` from pg-core `[assumption: confirm in Phase 0; fall back to customType]`.

**Queue decision.** We use graphile-worker. It gives us `jobKey` dedup and replacement, a crontab, LISTEN/NOTIFY latency, and a TypeScript API. It manages its own `graphile_worker` schema, and `hirelane_app` has no grants on it.

### 5.3 LLM and embeddings

**Modes.** `HIRELANE_LLM_MODE` takes one of:

| Mode | Behaviour |
|---|---|
| `auto` | Live when `ANTHROPIC_API_KEY` is set, otherwise fixture |
| `live` | Always call the API |
| `fixture` | Replay committed responses, keyed by `sha256(model + prompt)`. A cache miss falls to the deterministic fallback |
| `off` | Deterministic fallback only |

**Models.**
- `HIRELANE_MODEL_DRAFT=claude-opus-5-5` for resume parsing, answer drafting and tailoring.
- `HIRELANE_MODEL_BULK=claude-opus-5-5` (override to a cheaper model only if the owner chooses) for skills, salary, requirement and reply-classification fallback.
- Calls use tool-use JSON schemas, with output validated by zod.
- `llm_calls` logs model, purpose, tokens, latency and status. **It never stores content.**

**Deterministic fallbacks.**
- Engine rules for extraction.
- A section-heuristic resume parser.
- Drafting fills only from the structured profile and the answer bank. Every free-text field becomes Needs you, so nothing is fabricated.

**Embeddings.** `HIRELANE_EMBEDDINGS` is `hash` (the default, and what CI uses) or `local`.
- `hash` is a deterministic 384-dimension feature-hashed vector with TF-IDF weighting over title tokens and skills.
- `local` is an on-device MiniLM-class 384-dimension model, cached in `.cache/models` `[assumption: library chosen in Phase 4]`.
- pgvector column dimensions are fixed, so each row stores `embedding_model`. Changing provider means a migration plus the `embed:reindex` task.

### 5.4 Data flow

**Ingest.**
1. `ingest:schedule` creates an `ingest_runs` row and enqueues `ingest:source` once per enabled board, with job key `ingest:{ats}:{token}:{run}`.
2. Each source fetch:
   - has a per-host limit of 1 request per second and a 20MB response cap;
   - retries 3 times with exponential backoff;
   - honours `Retry-After` on a 429.
3. It upserts `postings` by `(board_id, external_id)` and computes `content_hash`.
4. New or changed postings go to `enrich:posting`, which:
   - runs the engine parsers;
   - runs the LLM fallback only on low confidence;
   - re-validates the LLM output;
   - dedups into `jobs`;
   - embeds.
5. `ingest:finalize`:
   - soft-closes postings absent from **2 consecutive successful** fetches of their board (**a failed fetch never closes anything**);
   - closes a canonical job when all its postings are closed;
   - refreshes the `job_facets` materialized view;
   - enqueues `match:user-delta`.

**Matching and autopilot.**
1. `match:user-delta` scores the new canonical jobs for each active user and writes `user_job_matches`.
2. It then enqueues `autopilot:run` for users with an enabled rule.
3. That queues `agent:draft` for each selected job, then `digest:send` once per batch.

**Application.** The approval state machine:

```
drafting → ready | needs_you → approved (undo_until = now() + 4s) → handed_off → sent → replied → interview → offer | rejected
            (any of these can also go to withdrawn)
```

- Undo is accepted only while the server's `now() < undo_until`.
- Commit is idempotent and consumes quota. The client calls commit at the end of the window; `application:commit-expired` sweeps any approvals left uncommitted.
- The handoff view is a user-gesture link (`target=_blank rel="noopener noreferrer"`) to the employer URL, beside the copy panel. This avoids popup blockers, and the employer page cannot be iframed anyway.

**Replies.**
1. The inbound webhook verifies its signature, stores the message encrypted, and enqueues `mail:inbound`.
2. `mail:inbound` resolves the alias (plus-token first, sender domain as fallback), classifies the message, writes an `application_events` row with any status change, and enqueues `mail:forward`.

### 5.5 Queue jobs

| Task | Trigger | Key / concurrency | Notes |
|---|---|---|---|
| `ingest:schedule` | cron `7 */6 * * *` | singleton | Creates the run |
| `ingest:source` | schedule | `jobKey` per board per run; 8 global, 1 per host | Fixture or live |
| `ingest:finalize` | last source done, or a 45-minute timeout | per run | Soft close, facets, enqueue match delta |
| `enrich:posting` | new or changed posting; `enrich_version` bump | `jobKey` per posting | Engine, then LLM fallback |
| `company:logo` | new company, or monthly | per company | SSRF-guarded |
| `embed:job` / `embed:resume` / `embed:reindex` | enrich, parse, provider change | per entity | |
| `match:user-full` | resume or profile change | `jobKey` per user (replace) | |
| `match:user-delta` | ingest finalize | per user | |
| `autopilot:run` | after match delta | per user | Drafts only |
| `agent:parse-resume` | upload | per resume | Sonnet or fallback |
| `agent:draft` | apply click, or autopilot | `jobKey` per application | |
| `resume:render` | tailoring accepted | per version | Playwright PDF |
| `digest:send` | autopilot batch | per batch | Idempotent through `outbound_messages` |
| `mail:inbound` / `mail:forward` | webhook | per message id | Forward p95 ≤ 60s |
| `application:commit-expired` | every minute | singleton | Commits approvals whose window has passed |
| `ops:freshness` | cron `*/15 * * * *` | singleton | Writes `slo_snapshots`, alerts |
| `retention:purge` | daily 03:30 UTC | singleton | See §10 |
| `billing:process-event` | payment webhook | per `event_id` | |
| `heartbeat` | every minute | singleton | Phase 0 smoke test |

---

## 6. Data model

All tables are created by numbered SQL migrations.

**Tenancy.**
- Every user-owned table has `ENABLE` and `FORCE ROW LEVEL SECURITY` with the policy `user_id = current_setting('hirelane.user_id')::uuid` for role `hirelane_app`.
- Public data (`companies`, `jobs`, `postings`, `job_requirements`, `skills`) is readable by `hirelane_app` without RLS.
- `sessions`, `payment_events` and `graphile_worker.*` are revoked from `hirelane_app`.

**Data conventions.**
- Money is `bigint` minor units plus `char(3)` currency.
- All rows have `created_at` and `updated_at timestamptz`.
- Fixture and seed rows carry `source = 'fixture'`, and the UI surfaces that.

### Identity and profile

| Table | Key columns | Indexes / constraints |
|---|---|---|
| `users` | `id uuid pk`, `email citext`, `email_verified_at`, `password_hash` (scrypt), `full_name`, `country char(2)`, `timezone`, `reply_handle text`, `role` (`user` / `admin`), `deleted_at` | `UNIQUE(email)`, `UNIQUE(reply_handle)` |
| `sessions` | `id text pk` (32 random bytes), `user_id`, `expires_at`, `user_agent` | `(user_id)`, `(expires_at)`; revoked from the app role |
| `email_tokens` | `id`, `user_id`, `purpose` (`verify` / `reset`), `token_hash`, `expires_at`, `used_at` | `UNIQUE(token_hash)` |
| `profiles` | `user_id pk`, `salary_floor_minor`, `salary_floor_currency`, `target_role_families text[]`, `current_level`, `remote_pref`, `locations jsonb`, `dealbreakers jsonb` (companies, keywords), `hide_below_floor bool`, `quiet_rejections bool`, `eeo_retain bool` (default false) | RLS |
| `work_authorizations` | `user_id`, `country char(2)`, `status` (`citizen` / `permanent` / `visa_held` / `needs_sponsorship`) | `PK(user_id, country)`; RLS |
| `answer_bank` | `id`, `user_id`, `question_key`, `label_seen`, `answer text` (encrypted), `sensitive bool`, `source` (`user` / `resume`), `last_used_at` | `UNIQUE(user_id, question_key)`; RLS |

### Resumes

| Table | Key columns | Indexes / constraints |
|---|---|---|
| `resumes` | `id`, `user_id`, `label`, `parent_id`, `blob_key` (encrypted file), `file_sha256`, `mime`, `parsed jsonb` (contact, experience[], education[], skills[]), `skills text[]`, `embedding vector(384)`, `embedding_model`, `parse_mode` (`llm` / `fallback`), `is_default`, `deleted_at` | `(user_id, created_at desc)`, `UNIQUE(user_id) WHERE is_default`; RLS |
| `resume_tailorings` | `id`, `user_id`, `application_id`, `base_resume_id`, `result_resume_id`, `diff jsonb`, `validator_report jsonb`, `status` (`proposed` / `accepted` / `rejected`) | RLS |

### Ingest and jobs (public)

| Table | Key columns | Indexes / constraints |
|---|---|---|
| `companies` | `id`, `slug`, `name`, `domain`, `logo_path`, `logo_source` (`favicon` / `touch_icon` / `monogram`), `name_source` (`config` / `board_meta`) | `UNIQUE(slug)`, `UNIQUE(domain)` |
| `company_boards` | `id`, `company_id`, `ats` (`greenhouse` / `lever` / `ashby`), `token`, `enabled`, `verified_at`, `consecutive_failures`, `last_success_at` | `UNIQUE(ats, token)` |
| `ingest_runs` | `id`, `trigger` (`cron` / `manual` / `fixture`), `mode`, `started_at`, `finished_at`, `status`, `boards_ok`, `boards_failed`, `postings_new`, `postings_changed`, `postings_closed` | `(started_at desc)` |
| `ingest_source_runs` | `run_id`, `board_id`, `status`, `http_status`, `fetched`, `new`, `changed`, `unchanged`, `closed`, `bytes`, `duration_ms`, `error_text` | `PK(run_id, board_id)`, `(board_id, run_id desc)` |
| `postings` | `id`, `board_id`, `external_id`, `key` (`ashby:openai:<uuid>`), `url`, `apply_url`, `title`, `location_raw`, `raw jsonb`, `content_hash`, `posted_at`, `first_seen_at`, `last_seen_at`, `missed_runs smallint`, `closed_at`, `job_id`, `source` (`live` / `fixture`) | `UNIQUE(board_id, external_id)`, `UNIQUE(key)`, `(job_id)`, `(board_id) WHERE closed_at IS NULL` |
| `jobs` (canonical) | `id`, `slug`, `company_id`, `title`, `title_norm`, `role_family`, `level`, `workplace`, `employment`, `remote bool`, `countries char(2)[]`, `locations jsonb`, `visa` (`yes` / `no` / `unknown`), `description_md` (sanitised), `salary_min_minor`, `salary_max_minor`, `salary_currency`, `salary_period`, `salary_annual_usd_min`, `salary_annual_usd_max`, `salary_annual_inr_min`, `salary_annual_inr_max`, `salary_source` (`ats_structured` / `text` / `llm`), `salary_trace jsonb`, `fx_date`, `skills text[]`, `simhash bigint`, `embedding vector(384)`, `embedding_model`, `posted_at`, `first_seen_at`, `last_seen_at`, `closed_at`, `enrich_version`, `primary_posting_id`, `source` | `UNIQUE(slug)`; partial btree `(coalesce(posted_at, first_seen_at) desc) WHERE closed_at IS NULL`; GIN `(skills)`, `(countries)`; GIN trigram `(title_norm)`; partial btree `(salary_annual_usd_min) WHERE salary_annual_usd_min IS NOT NULL AND closed_at IS NULL`; `(role_family, level) WHERE closed_at IS NULL`; HNSW `(embedding vector_cosine_ops)`; `(company_id, closed_at)` |
| `job_requirements` | `id`, `job_id`, `kind` (`must` / `nice`), `text`, `category`, `skill_ids text[]`, `years_min`, `span_start`, `span_end`, `extractor` (`rule` / `llm`), `confidence` | `(job_id)` |
| `skills` | `id` (slug), `label`, `aliases text[]`, `category`, `adjacent text[]` | GIN `(aliases)`; seeded from `packages/engine/data/skills.json` |
| `fx_rates` | `as_of date`, `currency`, `per_usd numeric(18,8)`, `source` | `PK(as_of, currency)` |
| `job_facets` (materialized view) | `role_family`, `country`, `remote`, `has_salary`, `n` | Refreshed concurrently at finalize |

### Matching, triage, applications

| Table | Key columns | Indexes / constraints |
|---|---|---|
| `user_job_matches` | `user_id`, `job_id`, `resume_id`, `score smallint`, `eligible bool`, `ineligible_reason`, `trace jsonb`, `engine_version`, `computed_at` | `PK(user_id, job_id, resume_id)`, `(user_id, score desc) WHERE eligible`; RLS |
| `job_passes` | `user_id`, `job_id` (canonical), `created_at` | `PK(user_id, job_id)`; RLS |
| `applications` | `id`, `user_id`, `job_id` (canonical), `posting_id` (apply target), `resume_id`, `status`, `origin` (`manual` / `autopilot` / `external`), `reply_token` (10-char base32), `use_alias bool`, `job_snapshot jsonb`, `requirements_snapshot jsonb`, `match_snapshot jsonb`, `approved_at`, `undo_until`, `handed_off_at`, `sent_at`, `batch_id`, `expires_at` | **`UNIQUE(user_id, job_id)`**, `UNIQUE(reply_token)`, `(user_id, status, updated_at desc)`; RLS |
| `application_answers` | `id`, `application_id`, `field_key`, `label`, `field_type`, `options jsonb`, `required`, `question_key`, `answer` (encrypted when sensitive), `answer_source` (`profile` / `resume` / `answer_bank` / `llm_draft` / `user`), `evidence jsonb` (resume spans), `needs_you bool`, `needs_you_reason` (`visa` / `start_date` / `salary` / `eeo` / `low_confidence` / `unknown`), `sensitive bool`, `ord` | `(application_id, ord)`; RLS |
| `application_events` | `id`, `application_id`, `user_id`, `at`, `type` (`drafted` / `edited` / `approved` / `undone` / `handed_off` / `confirmed_sent` / `reply` / `status_changed` / `note` / `expired`), `actor` (`user` / `system` / `autopilot` / `inbound`), `payload jsonb` | `(application_id, at)`; RLS |
| `idempotency_keys` | `user_id`, `key`, `endpoint`, `response jsonb`, `created_at` | `PK(user_id, key)`; purged after 24h |
| `form_specs` | `posting_id`, `ats`, `fields jsonb`, `discovered_via` (`ats_api` / `standard_template`), `fetched_at` | `PK(posting_id)` |

### Autopilot, email, billing, ops

| Table | Key columns | Indexes / constraints |
|---|---|---|
| `autopilot_rules` | `user_id pk`, `enabled`, `min_score`, `role_families text[]`, `my_role_only`, `max_level_delta` (0 or 1), `per_day`, `require_salary`, `paused_at`, `pause_token_hash` | RLS |
| `autopilot_batches` | `id`, `user_id`, `ran_at`, `drafted`, `ready`, `needs_you`, `digest_message_id` | `(user_id, ran_at desc)`; RLS |
| `inbound_messages` | `id`, `provider_message_id`, `user_id`, `application_id` (nullable), `matched_by` (`token` / `domain` / `none`), `from_addr`, `from_domain`, `subject`, `text_excerpt`, `blob_key` (raw, encrypted), `spf_pass`, `dkim_pass`, `classification` (`ack` / `reply` / `interview_ask` / `rejection` / `offer` / `security_code` / `unknown`), `received_at`, `forwarded_at` | `UNIQUE(provider_message_id)`, `(application_id, received_at)`, `(user_id, received_at desc)`; RLS |
| `outbound_messages` | `id`, `user_id`, `kind` (`forward` / `digest` / `verify` / `alert`), `dedupe_key`, `to_addr`, `status`, `sent_at` | `UNIQUE(dedupe_key)`; RLS |
| `plans` | `code`, `period` (`week` / `month`), `apps_quota`, `price_inr_paise`, `price_usd_cents`, `autopilot bool` | `PK(code)` |
| `subscriptions` | `id`, `user_id`, `plan_code`, `provider` (`razorpay` / `stripe` / `fake`), `provider_ref`, `status`, `period_start`, `period_end`, `cancel_at_period_end` | `(user_id, status)`; RLS |
| `usage_ledger` | `id`, `user_id`, `application_id`, `kind` (`consume` / `refund`), `period_key`, `at` | **`UNIQUE(application_id, kind)`**; RLS |
| `payment_events` | `provider`, `event_id`, `payload jsonb`, `received_at`, `processed_at` | `PK(provider, event_id)`; app role revoked |
| `llm_calls` | `id`, `purpose`, `model`, `mode`, `input_tokens`, `output_tokens`, `latency_ms`, `status`, `at` (no content) | `(at)`, `(purpose, at)` |
| `slo_snapshots` | `at`, `open_jobs`, `fresh_7h_pct`, `closure_lag_p95_h`, `source_success_7d`, `budget_remaining_pct`, `queue_lag_p95_s` | `(at desc)` |
| `audit_log` | `id`, `actor_user_id`, `action` (`resume_download` / `eeo_view` / `admin_view` / `export` / `delete`), `target`, `at`, `ip_hash` | `(actor_user_id, at)` |
| `feature_flags` | `key`, `enabled`, `user_id` (nullable) | `PK(key, coalesce(user_id, nil))` |
| `rate_limits` | `bucket`, `window_start`, `count` | `PK(bucket, window_start)` |
| `worker_heartbeats` | `worker_id`, `at` | |

---

## 7. API surface

### 7.1 Public (unauthenticated, read-only)
All public endpoints share these properties:
- CORS `*`
- rate limit 60 requests per minute per IP, with `429` and `Retry-After`
- `ETag`
- `Cache-Control: public, s-maxage=300`

| Method + path | Notes |
|---|---|
| `GET /api/public/jobs` | Parameters keep Shortlist's names: `q`, `role`, `country` (ISO alpha-2), `remote=1`, `salary=1`, `workplace` (`remote` / `hybrid` / `onsite`), `employment` (`fulltime` / `contract` / `parttime` / `intern`), `level` (`entry` / `mid` / `experienced` / `intern`), `visa=1`, `posted` (days), `page`. Additional parameters: `company`, `min_pay`, `currency` (`USD` / `INR`), `page_size` (max 100), `sort` (`fresh` / `pay`). The response is the envelope `{ jobs, page, pageSize, pages, total }` (the recon sample was a bare array even though llms.txt documents an envelope; ours is always the envelope, and a JSON-schema test enforces it) |
| `GET /api/public/jobs/{slug}` | The full job: `description_md`, `requirements[]`, `salary{min, max, currency, period, annualUsd, annualInr, source, fxDate, trace[]}`, `sources[{ats, url}]`, `firstSeenAt`, `lastSeenAt`, `closedAt` |
| `GET /api/public/companies`, `GET /api/public/companies/{slug}` | Company plus open-role counts |
| `GET /api/public/facets` | Counts by role × country, remote, with-salary (from `job_facets`) |
| `GET /api/public/status` | Last run, freshness percentage, boards ok / failed |
| `GET /openapi.json`, page `/api-docs` | OpenAPI 3.1 |
| `GET /job/{slug}` with `Accept: text/markdown` (or `/job/{slug}.md`) | Middleware rewrites to the markdown route handler, sets `Content-Type: text/markdown; charset=utf-8` and `Vary: Accept` on **both** representations, and respects q-values |
| `GET /llms.txt` | Our own text: what Hirelane is, when to recommend it, the API, honest limits (it includes "Hirelane prepares applications and hands off to the employer's form; it does not submit them") |
| `GET /sitemap.xml` | Sitemap index pointing to `/sitemaps/jobs/{n}.xml` (≤ 50,000 URLs each, `lastmod` = job `updated_at`, open jobs only), `/sitemaps/companies.xml` and `/sitemaps/lists.xml` |
| `GET /robots.txt` | Allows public pages; disallows `/api/` except `/api/public/`, `/applications`, `/triage`, `/ops` |

### 7.2 App (session cookie `__Host-hl_session`; HttpOnly, Secure, SameSite=Lax)
- Mutations are server actions (Next's built-in origin check) or route handlers with an explicit `Origin` check.
- Every handler runs inside `withUser`.

| Area | Endpoints / actions |
|---|---|
| Auth | `signup`, `login`, `logout`, `verifyEmail`, `requestReset`, `resetPassword`. Login is rate-limited to 5 per minute per IP+email. Errors are uniform and do not reveal whether an email exists |
| Resumes | `POST /api/resumes` (multipart; PDF or DOCX ≤ 5MB; magic-byte check), `GET /api/resumes`, `PATCH /api/resumes/{id}/parsed` (creates a new version), `POST /api/resumes/{id}/default`, `GET /api/resumes/{id}/file` (decrypt and stream; audited), `DELETE /api/resumes/{id}` |
| Profile | `GET/PUT /api/me/profile`, `PUT /api/me/work-authorizations`, `GET/PUT/DELETE /api/me/answers/{key}` |
| Triage | `GET /api/triage/next`, `POST /api/triage/{jobId}/pass`, `POST /api/triage/{jobId}/unpass` (≤ 4s), `POST /api/triage/{jobId}/apply` (`Idempotency-Key`; creates the application and enqueues `agent:draft`) |
| Applications | `GET /api/applications?status=`, `GET /api/applications/{id}`, `PATCH /api/applications/{id}/answers/{answerId}`, `POST /api/applications/{id}/resume` (swap version), `POST /api/applications/{id}/approve` (`Idempotency-Key`; returns `undoUntil`), `POST /api/applications/{id}/undo`, `POST /api/applications/{id}/commit` (idempotent; consumes quota; returns the handoff payload `{applyUrl, prefillUrl?, fields[{label, value, copyable}], replyAddress, resumeDownloadUrl}`), `POST /api/applications/{id}/confirm-sent`, `PATCH /api/applications/{id}/status` (kanban move), `POST /api/applications/{id}/tailor`, `POST /api/tailorings/{id}/accept`, `POST /api/applications/external` (records "applied elsewhere" to block duplicates) |
| Autopilot | `GET/PUT /api/autopilot`; `GET /autopilot/pause?t=` renders a confirmation page and `POST` performs the pause (resistant to link prefetchers; also served as `List-Unsubscribe-Post` one-click) |
| Inbox | `GET /api/inbox`, `POST /api/inbox/{id}/file` (attach to an application manually) |
| Billing | `POST /api/billing/checkout {plan, currency}`, `POST /api/billing/cancel`, `GET /api/billing` |
| Privacy | `GET /api/me/export` (zip of JSON plus files), `DELETE /api/me` (password re-confirm) |
| Webhooks | `POST /api/webhooks/inbound-email` (HMAC-SHA256 over timestamp + body, ±5 minutes, replay-proof by message id); `POST /api/webhooks/razorpay`, `POST /api/webhooks/stripe` (provider signature verification; `fake` provider in dev). All of them verify, persist and enqueue, then return 2xx |
| Ops (admin) | `GET /api/ops/runs`, `GET /api/ops/sources/{id}`, `GET /api/ops/slo` |

---

## 8. Page list

**Public.**
- `/`: the live ledger hero, one real preview, pricing.
- `/jobs`: the ledger with filter rail and URL-state filters.
- `/job/[slug]`: job page with JSON-LD `JobPosting`; `baseSalary` only when parsed.
- `/companies`, `/company/[slug]`.
- `/lists` and `/lists/[slug]`:
  - SEO lists generated from a registry in `apps/web/lib/lists.ts`, by role × country, remote × role and with-salary × role.
  - A list is published only when it has ≥ 20 open jobs. Below that threshold it is `noindex`.
  - Each list has a canonical URL and a live count plus "refreshed Xh ago" in the title.
- Content pages: `/how-it-works`, `/compare` (honest comparison by **category**: bulk bots, extensions, Hirelane; no brand names), `/pricing` (INR/USD), `/india`, `/about`, `/status`, `/api-docs`, `/privacy`, `/terms`, `/contact` (includes employer opt-out requests).
- Machine-readable: `/llms.txt`, `/sitemap.xml`, `/robots.txt`.

**Auth.** `/signup`, `/login`, `/verify-email`, `/reset`.

**App.**
- `/onboarding`: upload, then review the parse inline, then floor and currency, work authorisation, roles and level, dealbreakers.
- `/triage`
- `/applications` (kanban)
- `/applications/[id]`:
  - the preview with Needs-you fields, the approve bar and the undo;
  - after commit, the handoff panel;
  - the lane timeline and the reply thread.
- `/resumes`, `/resumes/[id]` (versions, diff view)
- `/autopilot` (rule, batches)
- `/inbox` (all replies, unfiled)
- `/settings` (profile, answer bank, reply address, privacy: export, delete, EEO retention)
- `/billing`
- `/autopilot/pause`

**Ops (admin).** `/ops`, `/ops/sources/[id]`, `/ops/slo`.

**Email templates** (`packages/agent/src/mail/templates/`): verify email, password reset, forward wrapper, autopilot digest, security-code forward, ops alert.

---

## 9. Phased build plan

### Rules that apply to every phase
- **Agent roster.** Use only these:
  - `planner`, `architect` and `code-explorer` are read-only; they plan, design and survey.
  - `tdd-guide` is **the only code writer**, UI included. It writes the failing test first, then the code.
  - `security-reviewer` is a **mandatory review before every push**.
  - `doc-updater` maintains docs and codemaps.
- **Engine modules are test-first.** The PR history shows the test commit before the implementation commit.
- **Every phase ends green** on all of the following:
  - `pnpm verify`, which is `test` + `typecheck` + `lint:deps` + `brand-guard` + `no-submit-guard` + `db:verify-schema` + `db:verify-rls` + `db:verify-auth` (the last two from Phase 4).
  - Its named Playwright spec (`pnpm e2e e2e/phase-N-*.spec.ts`), run against `http://localhost:3001` in fixture mode with no API key.
- **Screenshots.** Each spec calls `savePhaseScreen(page, N)` from `e2e/support/screens.ts`. It writes `docs/screens/phase-N.png` at a 1440px-wide full page, and the file is committed.
- **Branding.** `scripts/brand-guard.ts` fails when product surfaces contain case-insensitive `shortlist`, `shortlistapp`, or case-sensitive `\bPip\b` (word boundaries, so "pipeline" passes). Product surfaces are `apps/web/**`, `packages/*/src/**`, email templates and `public/`. `PLAN.md` and `docs/` are excluded.
- **No submission.** `scripts/no-submit-guard.ts` fails on any reference to an ATS application-submission host or path outside `packages/agent/src/submit/`.

---

### Amendment A (owner-approved 2026-10-16): warm intros are the core; India coverage

Hirelane's reason to exist is **jobs where you have a warm path in**. It combines this job data with a relationship
graph ported from WarmPath. The full plan, options, constraints and WarmPath source map are in `docs/network-plan.md`.

Changes to the phases below:
- **Phase 4 grows a Network track (4N),** built right after accounts, encryption and companies land.
  - It adds `packages/engine/src/network.ts` and `contacts-import.ts`, both pure, test-first and returning a Trace.
    They port WarmPath's warmth formula, coverage and gap types, and explanations.
  - It adds `packages/network`: persistence, plus an import task that runs in the worker.
  - Contact sources are user-provided only: your LinkedIn `Connections.csv` export, vCard or CSV, or manual add.
    Google Contacts via OAuth comes later.
  - Isolation and privacy: FORCE RLS per user, envelope encryption, and a separate "use my contacts in drafts"
    consent toggle.
  - Surfaces:
    - "You know N here" on the triage stack, the board (signed-in only) and company pages
    - a strongest-contact row with warmth written as its equation
    - a "has a contact" filter and a "match, then warmth" sort
    - a coverage view
    - one-key contact ratings
  - v1 is honest first-degree only: you, then a contact at the company. Two-hop paths wait for opt-in sharing.
- **Phase 5 adds intro and referral request drafts.** They use WarmPath's warm-intro prompt and output schema, go
  through the same evidence validator, and follow approve, 4 s undo and copy handoff. Hirelane never sends intro
  messages itself.
- **Phase 7:** Autopilot rule option "only companies where I know someone".
- **Phase 8:** export, delete and retention cover contacts, imports and intro drafts. The log PII scan includes the
  synthetic contact fixture.
- **Never:** scraping LinkedIn or any site, Proxycurl, Happenstance or Crustdata as data sources, or cross-user
  aggregates ("3 Hirelane users know someone at Stripe").
- **India coverage (owner decision):** add Indian companies' public ATS boards (Greenhouse, Lever and Ashby, verified
  one by one) to the Phase 1 board list. Today only 1,178 of 16,320 open roles (7%, at 61 companies) are in India, yet
  pricing and positioning are India-first.

### Amendment B (PROPOSED 2026-10-29, pending owner approval): campus-first; resume hardened first

Status: campus-first is the owner's direction (2026-10-29). The detail below (migration numbers, columns, caps, libraries) is a proposal and becomes binding only when the owner approves it. Library choices are (verify) until the main session checks versions, licences and CVE fixes.

Source: docs/product/CAMPUS-FIRST.md. Build plan: docs/design/campus-build-plan.md. Where this amendment and any earlier section of this file, docs/design/hld-lld-core-loop.md or docs/product/FINAL-PRD.md disagree, **this amendment wins**.
**Build order:**
1. Slice 1 (pure resume and eligibility engine) and Slice 2 (accounts), in parallel.
2. Slice 3: upload, extract, confirm, eligibility profile, builder, /api/v1.
3. HLD M3–M7.

Campus Slice 4b is gated on G4.

1. **Direction.**
   - The payer is the placement cell.
   - The user is the student the on-campus drives didn't place.
   - Screens are designed for tier-3 students: phone-only, low-end Android, metered data.
   - Students use it free when their college pays.
2. **Resume inputs.** This replaces "PDF only" in HLD §2.1 and HLD gap 14, and amends PLAN 4.4.
   - Text PDF and **DOCX**, ≤ 5 MB. PDFs ≤ 3 pages; DOCX gets a soft word-count warning instead. Magic bytes are checked (`%PDF-` / `PK\x03\x04`). No photos or images.
   - DOCX goes through a zip guard before inflating:
     - ≤ 300 entries
     - only the document, header, footer and `docProps/core.xml` parts are inflated
     - streamed inflate with real byte caps (10 MB per entry, 25 MB total, ratio ≤ 200)
   - Reject `.docm`/`vbaProject.bin`, `altChunk`, nested archives, and any `<!DOCTYPE`/`<!ENTITY`. There is no XML parser. External relationships are flagged.
   - **PDF:** pdf.js via unpdf (verify), pinned past CVE-2024-4367 (verify), `isEvalSupported:false`, no remote font or cmap fetches. JavaScript, actions and embedded files are never executed or extracted. Encrypted PDFs are refused.
   - **Image-only PDFs: detect first, OCR deferred.**
     - `text_layer = none` when there are fewer than about 30 non-space characters per page.
     - `text_layer = garbled` when more than 30% of the text is private-use characters or U+FFFD (Canva).
     - Either case is health issue #1, with two fixes: re-export as text, or use the builder.
     - OCR is a separate owner decision.
   - Extraction lives in `workers/runner/src/resume/extract/`, in a fresh `worker_threads` Worker per job (`resourceLimits` 256 MB, 10 s, then terminate). The dep-cruiser rule `extractors-worker-only` bans unpdf, pdfjs-dist, fflate (verify), pdfkit and fontkit outside `workers/runner`.
   - Upload is a route handler (`POST /api/v1/resumes`), not a server action. The original file name lives only inside `parsed_enc`.
   - Graphile job payloads carry IDs only.
3. **Parse.** This replaces PLAN 4.4 "Sonnet structured parse" and `agent:parse-resume`.
   - The task is `resume:extract`. It runs rules only, is India-aware, and makes 0 LLM calls (an LLM only with `llm_resume` consent, later). Section, education, sensitive and health logic are pure code in `packages/engine/src/resume/`.
   - Education entries: 10th, 12th or diploma, UG, optional PG, each with board, %/CGPA and scale, start and passout years. Active backlogs and backlog history are kept separate.
   - Every field carries confidence and is editable on one confirm screen. **Nothing feeds matching or eligibility until the student confirms.**
4. **Sensitive data.**
   - Detected on NFKC-normalised text with Devanagari digits mapped:
     - Aadhaar: 12 digits, first digit 2–9, Verhoeff-valid, context-scored so +91 phones and roll numbers don't match. Masked forms and the 16-digit VID are flagged.
     - PAN
     - DOB or age
     - parents' names (including S/o and D/o)
     - religion, caste/category and marital status, matched only next to a label ("Christ University" must not match)
     - image presence, reported as "image found"
   - The filename and file metadata are scanned too.
   - Findings store kind and offsets, **never the value**. Aadhaar and PAN are masked in place (same length) **before** `parsed_enc` is sealed, and are never displayed. The original sealed file is untouched. The student is prompted to upload a clean copy or use the builder, and the old original is purged within 24 h.
5. **Health check** (deterministic, free).
   - Nine fixed checks: ats_readable, one_page, contact_present, no_biodata_ids, no_padding, bullets_with_numbers, project_proof_links, skills_in_text, sensible_file_name.
   - Each returns pass / fail / unknown with a reason and a fix. DOCX one_page is unknown. With no text layer, ats_readable fails and the rest are unknown.
   - Shown as "N of 9 checks pass", failing checks first. **No score out of 100.**
6. **Guided builder.** This replaces `resume:render` "Playwright PDF".
   - 6–8 short questions produce a one-page, single-column PDF that an ATS can read.
   - Rendered in the worker with **pdfkit** (verify) and one bundled OFL font (Noto Sans, so ₹ renders). pdf-lib with fontkit is the fallback.
   - A round-trip test is required: builder output must pass our own text-layer check.
   - No Playwright and no client-side PDF libraries.
7. **Eligibility profile** (`eligibility_profiles`, 0009; RLS own; plain columns written only on confirm, because matching and k ≥ 10 SQL aggregates need them).
   - Columns: pct_10, board_10; secondary_kind (12th|diploma), pct_secondary, board_secondary; degree, branch_code, branch_raw; grad_score, grad_scale (4/5/10/100), grad_pct_equiv, grad_conversion (`campus:<id>`|`direct`|`unknown`), grad_is_final; active_backlogs, backlog_history; gap_years; passout_year; lateral_entry; field_meta (source and confidence, no values); source_resume_id; confirmed_at.
   - No gap-reason column.
   - CGPA→% conversion comes only from `campuses.cgpa_rule`. Without it, a CGPA-vs-% criterion is **unknown**.
   - Academic numbers are never shown per student to a TPO.
8. **`engine/eligibility.ts`** (pure, test-first).
   - `parseCriteria(text)` → criteria with evidence spans: minimum %/CGPA per level or "throughout", no active backlogs, max backlog history, passout years, degrees, branches (alias table), max gap.
   - `evaluateEligibility` → pass / fail / unknown per criterion. Diploma substitutes for 12th where stated. Missing input means unknown.
   - **Fail is a worthwhile-gate blocker. Unknown never blocks.** Eligibility is an optional `isWorthwhile` input.
   - The corpus is synthetic, modelled on real drive notices that the main session sources (tdd-guide has no web access).
9. **Accounts.** This replaces PLAN §6 passwords and §7.2 signup, login and reset.
   - Google OIDC (PKCE) plus a 6-digit email code. Opaque sessions: the `__Host-hl_session` cookie for web, and `Authorization: Bearer hl_at_…` for a future Android app.
     - Bearer sessions use the same `sessions` table with `client='android'`, a 30-day sliding expiry and a 90-day absolute expiry. No JWT.
     - The Bearer path is designed now and built later.
   - **Phone OTP:** the columns and the `phone_otp` provider ship in 0008. Sending waits for the owner's vendor decision.
   - **18+ gate (DPDP s.9):** no `users` row exists until the person attests "I am 18 or older", recorded as consent `age_18_plus`. No DOB is collected.
10. **The `accounts` flag.** Sign-up and every resume or builder write sit behind it. It is on in the dev seed and e2e, and off elsewhere until the grievance officer is named.
11. **Web and /api/v1 parity.**
    - New package `packages/services`: `fn(ctx, input)`, zod at the boundary, `ServiceError(code, status)`, `withUser` only. It is never on the withAdmin allowlist.
    - Server actions and `/api/v1/*` handlers both call it. The dep-cruiser rule `api-v1-thin` stops routes and actions from importing `@hirelane/db`, and a test fails if an action has no v1 twin.
    - v1 conventions: Origin check on cookie mutations, `Idempotency-Key` on mutations, problem+json errors.
    - The v1 OpenAPI doc lives at `/api/v1/openapi.json`, separate from the public one.
12. **Keep it light** (binding acceptance criteria).
    - No new infrastructure.
    - Student pages are server-rendered and ship ≤ 100 KB gzip of first-load JS per route, checked by `pnpm budget`. They may not import motion, radix-ui or sonner.
    - Heavy work runs only in workers/runner.
    - 0 LLM calls in these slices.
13. **Migrations.** 0007 is `rls_posture`. Order:
    - **0008** auth: users, auth_identities, sessions (+client, absolute_expires_at), otp_challenges (+purpose), consents (+age_18_plus, campus_share, offer_letter_tpo), product_events, idempotency_keys
    - **0009** profiles (college_tier, cohort_code, grad_year and degree removed), work_authorizations, answer_bank, resumes (revised; `dek_wrapped` dropped; the ≤ 3 trigger counts roots), file_access_log, eligibility_profiles
    - **0010** campus
    - **0011** matching
    - **0012** applications
    - **0013** drives and outcomes (after G4)
    - **0014+** inbound and billing

    RLS is ENABLE, not FORCE. `verify-rls` gains the modes `own-r` and `ten`, a SECURITY DEFINER registry and an `updateSql` hook.
14. **Retention.** Downloads go to `file_access_log`, written in the same transaction. Resume or account deletion purges the blob and `parsed_enc` within 24 h: `resume:purge` runs immediately, with a daily sweep as backstop.
15. **Campus.**
    - **Access:** TPOs read only through SECURITY DEFINER functions under `withUser`, over daily `cohort_stats_daily` snapshots.
    - **Suppression:** k = 10, counted over *verified* members. A cell is suppressed if n < 10 or |P| − n < 10. Counts are rounded to 5, dimensions are fixed, and there are no caller filters.
    - **Student control:** share levels are aggregate (default), outcomes or full. The TPO never sees resume contents, answers or marks. Every TPO read of a student is logged and visible to that student.
    - **Joining:** campus codes are 8-character base32, looked up by HMAC and rate-limited. Code joins don't count toward k. College-email domains are entered by ops and proved by OTP; one mailbox gets one seat.
    - **Roster import:** stores email HMAC and a placed flag only. No names or roll numbers.
    - **Drive inbox:** never fetches the pasted link.
    - **Outcomes:** labelled "student-reported" or "TPO-verified". The NAAC export is CSV-injection safe and audited.
    - **Gating:** C3–C5 are **gated on G4**.
16. **Process.** CLAUDE.md wins over §9's roster. tdd-guide builds logic and its tests. The main session builds UI (after loading `frontend-design`) and verifies library and vendor claims. security-reviewer reviews every slice, Slice 1 included.

### Phase 0: Scaffold
**Goal:** a monorepo that is empty but real, runs offline end to end, and follows solum conventions.

| # | Task | Agent |
|---|---|---|
| 0.1 | Turn this plan into a tracked issue list (one issue per task, with acceptance criteria copied in) | planner |
| 0.2 | Write `docs/architecture.md`: the package dependency rules (§5.2), the ORM/migration decision, the queue choice, env vars; and `.dependency-cruiser.cjs` rules | architect |
| 0.3 | Root `package.json`: `pnpm@9.12.0`, `node >= 20`, and these scripts: `dev`, `worker`, `test`, `e2e`, `typecheck`, `lint:deps`, `verify`, `db:up`, `db:down`, `db:migrate`, `db:seed`, `db:reset`, `db:fresh` (reset, then migrate, then seed), `db:verify-rls`, `db:verify-auth`, `db:verify-schema`, `ingest:run`, `ingest:record`, `engine:eval`, `agent:eval`, `report:coverage`, `bench:board`. Also `pnpm-workspace.yaml` (`packages/*`, `apps/*`, `workers/*`), `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), and `.gitignore` (`.env`, `storage/`, `.mail/`, `.cache/`) | tdd-guide |
| 0.4 | `docker-compose.yml`: service `postgres`, image **`pgvector/pgvector:pg16`** (solum's `postgres:16-alpine` has no pgvector), `container_name: hirelane-postgres`, `5433:5432`, `pg_isready` healthcheck, volume `hirelane-pgdata`. `.env.example` lists every variable in §5.3 and §10, with `DATABASE_URL=postgres://hirelane:hirelane@localhost:5433/hirelane` | tdd-guide |
| 0.5 | `packages/db`: port `client.ts` (`withAdmin`, and `withUser`, which does `SET LOCAL ROLE hirelane_app` plus `set_config('hirelane.user_id', …, true)`), the `migrate.ts` checksum runner, `reset.ts`, `seed.ts`, the Drizzle setup, and `verify-schema.ts`. Migration `0001_foundation.sql`: `vector`, `pg_trgm`, `citext` and `pgcrypto` extensions; role `hirelane_app NOLOGIN`; `worker_heartbeats`; `feature_flags`; `rate_limits`. Tests: an edited migration is refused; a drift check catches a missing column | tdd-guide |
| 0.6 | `apps/web`: Next 15, React 19, Tailwind v4 (`@tailwindcss/postcss`); `globals.css` with the POV header and the `@theme` tokens from §4.2; Overpass variable font from `@fontsource-variable/overpass` (OFL text vendored) through `next/font/local`; the wordmark SVG and favicon; layout shell with a one-line footer; `next dev -p 3001` and `next start -p 3001`; `lib/{queries,session,format}.ts` stubs | tdd-guide |
| 0.7 | `workers/runner`: graphile-worker bootstrap, a crontab file, and a `heartbeat` task. `packages/db/src/queue.ts` provides the `addJob` wrapper | tdd-guide |
| 0.8 | vitest workspace config. Playwright config (`webServer: pnpm dev`, `baseURL http://localhost:3001`, `reuseExistingServer`, globalSetup runs `db:fresh` in fixture mode). `e2e/support/screens.ts`. `e2e/phase-0-shell.spec.ts` | tdd-guide |
| 0.9 | `scripts/brand-guard.ts` and `scripts/no-submit-guard.ts`, each with self-tests ("pipeline" passes, "Pip drafts" fails), wired into `verify` | tdd-guide |
| 0.10 | Review: `.env.example` contains no secrets; DB roles and grants; `.gitignore` coverage; Docker port binding is `127.0.0.1` only | security-reviewer |
| 0.11 | `README.md` "Running it" section (solum format) and the codemap in `docs/architecture.md` | doc-updater |

**Acceptance**
- [ ] On a clean clone, `pnpm install && pnpm db:up && pnpm db:fresh` exits 0. Everything after `install` succeeds with the network disabled.
- [ ] `SELECT extname FROM pg_extension` returns `vector`, `pg_trgm`, `citext` and `pgcrypto`.
- [ ] `pnpm verify` is green, with ≥ 6 tests across `db` and the guards.
- [ ] `pnpm worker` writes a `worker_heartbeats` row within 70 seconds.
- [ ] The app runs on :3001. `pnpm e2e e2e/phase-0-shell.spec.ts` passes, and `docs/screens/phase-0.png` is saved, showing the wordmark, the fonts loaded (asserted through `document.fonts.check`) and the paper background.

---

### Phase 1: Ingest (three ATS connectors, fixtures, run stats)
**Goal:** about 100 verified boards ingested into `postings` with per-source run stats and safe soft-closing. Fully offline from a recorded fixture.

| # | Task | Agent |
|---|---|---|
| 1.1 | Define the `RawPosting` contract and the connector interface `fetchBoard(token, {mode, fetch, signal})`. Write the soft-close rule (2 consecutive successful misses; a failed fetch closes nothing). Record which ATS fields are `[assumption]` until the fixture confirms them | architect |
| 1.2 | Compile `packages/ingest/boards.candidates.json` with ≥ 140 candidates (company display name, domain, ats, token) to net ~100, with ≥ 25% of them companies that hire in India. Only `ashby:openai`, `ashby:benchling` and `ashby:temporal` are `[verified]` (from the recon sample); every other entry starts as `[assumption]` | planner |
| 1.3 | Recorder `pnpm ingest:record` (live, run manually, never in CI): UA `HirelaneBot/0.1 (+APP_ORIGIN/contact)`, 1 request per second per host. It writes `fixtures/full/{ats}/{token}.json.gz` (≤ 25MB total) and `boards.json` with `verified_at` and HTTP status, drops 404s and empty boards, and derives `fixtures/mini/` (5 boards including openai, benchling and temporal) for unit tests | tdd-guide |
| 1.4 | Connectors `greenhouse.ts` (`/v1/boards/{token}/jobs?content=true`), `lever.ts` (`/v0/postings/{company}?mode=json`) and `ashby.ts` (`/posting-api/job-board/{org}?includeCompensation=true`), plus `normalize()`. Tests are written against the **recorded mini fixture**, not from memory. Covered: HTML-entity-encoded content, missing locations, millisecond timestamps, secondary locations | tdd-guide |
| 1.5 | Migrations `0002_companies_boards_postings.sql` and `0003_ingest_runs.sql`. Persistence: upsert by `(board_id, external_id)`; `content_hash` diff; `first_seen_at` and `last_seen_at`; increment `missed_runs`; soft close | tdd-guide |
| 1.6 | Worker tasks `ingest:schedule` (cron `7 */6 * * *`), `ingest:source` and `ingest:finalize`. Per-host limiter, retries and backoff, `Retry-After`, 20MB cap, 30-second timeout. CLI `pnpm ingest:run --mode fixture\|live` | tdd-guide |
| 1.7 | A minimal `/ops/ingest` (gated by `HIRELANE_OPS_TOKEN` until Phase 4 admin roles) and a raw `/jobs` table without filters | tdd-guide |
| 1.8 | Review: SSRF (URL templates are fixed and tokens come from config only, never from users); response caps; raw HTML stored but never rendered; recorder UA and rate | security-reviewer |
| 1.9 | `docs/ingest.md`: sources, cadence, the soft-close rule, how to re-record fixtures, the per-ATS terms checklist (status: needs human review) | doc-updater |

**Acceptance**
- [ ] `pnpm --filter @hirelane/ingest test` has ≥ 30 passing tests covering all three connectors against the mini fixture.
- [ ] `boards.json` lists ≥ 100 verified boards, each with a `verified_at` timestamp.
- [ ] `pnpm ingest:run --mode fixture` ingests every verified board in < 60 seconds on a laptop. The posting floor is set from the recorded count `[assumption: ≥ 5,000]`. An immediate second run reports 0 new and 0 changed.
- [ ] Removing one posting from a fixture and running twice closes exactly 1 posting. Injecting HTTP 500 for a board across 3 runs closes 0 postings.
- [ ] One `ingest_source_runs` row exists per board per run with non-null counts.
- [ ] The app runs on :3001. `e2e/phase-1-ingest.spec.ts` passes (`/ops/ingest` shows the last run and per-source counts), and `docs/screens/phase-1.png` is saved.

---

### Phase 2: Enrichment engine (test-first)
**Goal:** every posting becomes a canonical job carrying the full set of derived fields, and every one of them carries a `Trace`. The derived fields are:
- normalised salary
- structured requirements
- skills
- level, workplace, employment
- countries
- visa
- role family
- canonical company and logo
- dedup cluster

| # | Task | Agent |
|---|---|---|
| 2.1 | Engine contracts and `ENGINE_VERSION`: `parseSalary`, `normalizeSalary(parse, fx)`, `extractSkills`, `extractRequirements`, `classifyLevel`, `classifyWorkplace`, `classifyEmployment`, `classifyRoleFamily` (~25 families), `resolveCountries` (gazetteer), `detectVisa`, `canonicalTitle`, `simhash64`, `dedupMatch`. Rule: deterministic first; LLM output must cite evidence that the engine re-validates | architect |
| 2.2 | Labelled corpora, written **before** the code: `test/corpus/salary.labelled.jsonl` (≥ 300 snippets sampled from the fixture plus 60 hand-written INR/EU/hourly/monthly/OTE/false-positive cases), `requirements.labelled.jsonl` (60 postings), `dedup.pairs.jsonl` (200 pairs). Who labelled each and when is recorded in the file header | tdd-guide |
| 2.3 | `salary.ts` to the full specification in §3.1, structured-compensation first. Integer minor units. `fx_rates` fixture snapshot tagged with source and date. Unparseable gives `null` | tdd-guide |
| 2.4 | `data/skills.json`: ≥ 600 skills with aliases and adjacency, including handling of ambiguous tokens such as "Go" (counted only with context: "Golang", or appearing in a skills list), "R", "C++" and "C#". Plus `skills.ts` | tdd-guide |
| 2.5 | `requirements.ts`: section detection, bullet splitting, must vs nice, minimum years, category, evidence spans | tdd-guide |
| 2.6 | Classifiers plus `data/places.json` (countries, US states, major cities including Bengaluru/Bangalore, Gurugram/Gurgaon). Visa is `yes` only on explicit positive phrases; "unable to sponsor" gives `no`; everything else is `unknown` | tdd-guide |
| 2.7 | `packages/agent/src/llm/` providers (Anthropic, Fixture, Null), the `HIRELANE_LLM_MODE` switch, batched Haiku calls, prompt caching, `llm_calls` logging (no content). Job text is passed as delimited **untrusted data** | tdd-guide |
| 2.8 | Migration `0004_jobs_enrichment.sql` (`jobs`, `job_requirements`, `skills`, `fx_rates`, `companies` columns). Worker `enrich:posting` and dedup clustering. Bumping `enrich_version` triggers re-enrichment | tdd-guide |
| 2.9 | Company canonicalisation (config display name, then board metadata `[assumption: Greenhouse board-name endpoint]`). `company:logo` covers SSRF guard, ≤ 2 same-domain redirects, ≤ 200KB, content-type allowlist, re-encode with sharp, committed fixture logos, monogram fallback | tdd-guide |
| 2.10 | Bare `/job/[slug]` showing salary with its trace expander, the requirements split, the logo and freshness | tdd-guide |
| 2.11 | Review: prompt injection from job descriptions; LLM output validation; logo fetch SSRF and decompression bombs; no content in logs | security-reviewer |
| 2.12 | `docs/enrichment.md`: parse rules, thresholds, how to run `engine:eval` and `report:coverage`, known gaps | doc-updater |

**Acceptance**
- [ ] `pnpm --filter @hirelane/engine test` has ≥ 250 tests, with ≥ 90% line coverage on `salary.ts`, `requirements.ts` and `dedup.ts`. The test commits precede the implementation commits.
- [ ] `pnpm engine:eval` prints the following and exits non-zero below threshold:
  - salary precision ≥ 0.98, recall ≥ 0.95, period and currency accuracy ≥ 0.98;
  - requirements must/nice F1 ≥ 0.85;
  - dedup with 0 false merges and ≥ 0.9 recall on the 200 pairs.
- [x] `pnpm report:coverage` on the full fixture shows:
  - salary coverage (target ≥ 50%), reported alongside the "stated anywhere" ceiling;
  - ≥ 1 must-have requirement on ≥ 90% of jobs;
  - a country, or "remote: worldwide", on ≥ 98% of jobs;
  - role family assigned on ≥ 95% of jobs.
- [x] With `ANTHROPIC_API_KEY` unset, a full enrichment completes with `llm_calls = 0`, and every job has a `salary_trace` whenever it has a salary.
- [ ] The app runs on :3001. `e2e/phase-2-job.spec.ts` passes (an INR LPA job shows "₹18–25 L/yr" with a trace that lists the period and fx steps), and `docs/screens/phase-2.png` is saved.

---

### Phase 3: Public board and distribution
**Goal:** the full public board in the timetable design, and every machine-readable surface live.

| # | Task | Agent |
|---|---|---|
| 3.1 | URL scheme, caching (revalidate 300s for lists; job pages revalidated on re-enrich), a single-SQL filter design, and the `job_facets` materialized view | architect |
| 3.2 | Query layer `apps/web/lib/queries/jobs.ts`: trigram `q` over title, company and skills; all filters; `coalesce(posted_at, first_seen_at)` for "posted within"; sort by fresh or pay; maximum 100 pages | tdd-guide |
| 3.3 | `/jobs` ledger with filter rail (URL state, keyboard navigation, mobile two-line rows); full `/job/[slug]`; `/companies`, `/company/[slug]` | tdd-guide |
| 3.4 | `/api/public/*` route handlers, rate limiting through `rate_limits`, ETag, CORS, `/openapi.json`, `/api-docs`. JSON-schema contract tests | tdd-guide |
| 3.5 | Markdown negotiation middleware plus the route handler (`Vary: Accept`, `.md` suffix); `/llms.txt`; the sitemap index and chunks; `robots.txt` | tdd-guide |
| 3.6 | SEO list registry, `/lists`, `/lists/[slug]` (≥ 20 jobs, otherwise `noindex`; canonical URLs); JSON-LD `JobPosting` `[assumption: field rules verified against Google's guidelines in this phase]` | tdd-guide |
| 3.7 | `/` (live ledger hero, a real preview with fixture data, pricing placeholder), `/how-it-works`, `/compare`, `/about`, `/status` | tdd-guide |
| 3.8 | Review: sanitising employer HTML into markdown (sanitize-html allowlist, no raw HTML render); rate-limit bypass through header spoofing (trust only the configured proxy); no PII on public pages | security-reviewer |
| 3.9 | `docs/public-api.md`; a test that keeps `llms.txt` parameter names in sync with the OpenAPI document | doc-updater |

**Acceptance**
- [ ] `pnpm bench:board` (30-second load on the full fixture) gives `/jobs` p95 ≤ 300ms and `/api/public/jobs` p95 ≤ 150ms.
- [ ] A 40-case filter table validates against the JSON schema, and `total` equals `count(*)` in every case.
- [ ] `curl -H 'Accept: text/markdown' localhost:3001/job/<slug>` returns `text/markdown`, includes `Vary: Accept`, and the body is ≤ 30% of the HTML size.
- [ ] The sitemap index validates (xmllint in the test), lists every open job exactly once, and lists 0 closed jobs.
- [ ] axe-core reports 0 serious or critical violations on `/`, `/jobs`, `/job/[slug]`, `/company/[slug]` and `/lists/[slug]`. `brand-guard` is green.
- [ ] Design review checklist: none of the 19 banned tropes is present (the reviewer ticks each one in the PR).
- [ ] The app runs on :3001. `e2e/phase-3-board.spec.ts` passes (remote + salary-only + country=IN changes the count and the URL; the job page opens; the markdown variant is fetched), and `docs/screens/phase-3.png` (`/jobs`) is saved.

---

### Phase 4: Accounts, resumes, matching, triage
**Goal:**
- A user can sign up, upload a resume, review the parse, set preferences, and triage explained matches one card at a time.
- Resume PII is encrypted and isolated by RLS.

| # | Task | Agent |
|---|---|---|
| 4.1 | `docs/privacy-model.md`: RLS policy list, the envelope-encryption design (per-file data key, AES-256-GCM, wrapped by `HIRELANE_MASTER_KEY`), the `BlobStore` interface (local encrypted disk now, S3 later), sessions, the redaction list. Plus the matching formula specification (§3.4) | architect |
| 4.2 | Migrations `0005_auth.sql` (users, sessions revoked from the app role, `email_tokens`) and `0006_profiles_resumes.sql` (profiles, work_authorizations, answer_bank, resumes, with FORCE RLS). `verify-rls.ts` (≥ 12 checks, including cross-user reads of resumes, answers, matches and passes, and app-role reads of sessions) and `verify-auth.ts` (≥ 15 checks, ported from solum) | tdd-guide |
| 4.3 | Auth: signup, login, logout, email verification, reset; a file mailer writing `.mail/outbox/*.eml`; rate limits; the admin role, replacing the ops token | tdd-guide |
| 4.4 | Resume upload: magic bytes, ≤ 5MB, ≤ 6 pages; text extraction `[assumption: unpdf and mammoth, confirmed in-phase]`; contact details extracted by regex and **redacted before the LLM**; Sonnet structured parse with the section-heuristic fallback; inline review page; immutable versions | tdd-guide |
| 4.5 | Engine `match.ts`, **test-first**: the formula, eligibility gate, fx-converted floor, adjacency credit, the `Trace`, and golden tests (a fixture user × 50 jobs, ±1 point) | tdd-guide |
| 4.6 | Embedding providers (`hash` as default, `local` optional), the HNSW index, `embed:*` tasks. Candidate generation takes the top 500 by cosine **plus** all jobs with ≥ 50% skill overlap, then the engine scores them fully | tdd-guide |
| 4.7 | `match:user-full` and `match:user-delta`; the `/onboarding` flow; preferences | tdd-guide |
| 4.8 | `/triage` docket: the match ledger with resume evidence spans; A / P / U keys; pass is stored on the canonical job and can be undone for 4 seconds; Apply creates a `drafting` application (drafting itself arrives in Phase 5) | tdd-guide |
| 4.9 | **Deep review:** sessions (cookie flags, fixation, revocation), scrypt parameters, enumeration-safe errors, RLS bypass attempts, upload parsing (zip bombs in DOCX, PDF JavaScript), at-rest encryption, PII redaction on the LLM path, log redaction | security-reviewer |
| 4.10 | `docs/matching.md` (formula with a worked example), plus updates to the privacy model and codemap | doc-updater |

**Acceptance**
- [ ] `pnpm db:verify-rls` (≥ 12 checks) and `pnpm db:verify-auth` (≥ 15 checks) pass, and both are part of `pnpm verify`.
- [ ] The fallback parser on 10 committed **synthetic** resumes extracts name, email and phone at 100%, and skill recall is ≥ 90%.
- [ ] Uploaded files are ciphertext on disk: the test greps the stored blob for the fixture email and finds 0 hits.
- [ ] Match golden tests pass. A property test shows that, over 1,000 random cases, the displayed terms sum exactly to the displayed score.
- [ ] Over 1,000 random profiles, 0 ineligible jobs reach triage. A passed job re-posted on another board never reappears.
- [ ] The app runs on :3001. `e2e/phase-4-triage.spec.ts` passes (signup, upload a synthetic resume, fix one parsed skill inline, set a ₹ floor, see a card reading "N of M requirements", pass, next card), and `docs/screens/phase-4.png` is saved.

---

### Phase 5: Drafting, approval, undo, handoff, tailoring
**Goal:** the core loop works end to end up to handoff, never submits, and never applies twice.

| # | Task | Agent |
|---|---|---|
| 5.1 | Form model:
<ul><li>A `FormSpec` per posting, built from the ATS standard-field template plus any custom questions discovered.</li><li>Greenhouse question discovery is `[assumption: job endpoint with questions=true; verify]`. Lever and Ashby use the standard template, with the note "employer may ask more on their form".</li><li>A per-ATS handoff capability registry `packages/agent/src/handoff/capabilities.ts`: `prefill: 'none' \| 'url_params'`. **Every ATS starts at `none`.** It changes only after an in-phase verification on a live public posting, recorded with a date.</li></ul> | architect |
| 5.2 | Engine `questions.ts`, **test-first**: maps labels to `question_key` (years_of_x, why_company, why_role, visa_sponsorship, work_authorization_{cc}, start_date, notice_period, salary_expectation, eeo_*, relocation, links, referral, cover_letter, other). Sensitivity policy:
<ul><li>visa, authorisation, start date, salary, EEO, criminal history and age are **always Needs you** unless the answer bank holds a user-given answer;</li><li>EEO always requires per-application confirmation, with "Decline to self-identify" offered.</li></ul> | tdd-guide |
| 5.3 | Drafting with Sonnet:
<ul><li>Inputs: resume version, profile, answer bank, requirements snapshot.</li><li>Output: one answer per field, each with evidence spans.</li><li>A validator turns any unsupported sentence into Needs you (`low_confidence`), and field length limits apply.</li><li>No-key fallback: structured answers only, everything else Needs you.</li><li>`pnpm agent:eval` runs a 50-draft set.</li></ul> | tdd-guide |
| 5.4 | Migration `0007_applications.sql`: applications with `UNIQUE(user_id, job_id)`, answers, events, `idempotency_keys`, `form_specs`, `resume_tailorings`, and snapshots captured at draft time | tdd-guide |
| 5.5 | Preview `/applications/[id]`:
<ul><li>fields in ATS order;</li><li>Needs-you rules, with Approve disabled until every Needs-you field is filled;</li><li>inline edit, plus "remember this answer" into the answer bank;</li><li>resume version swap;</li><li>the email that will be used (the alias).</li></ul> | tdd-guide |
| 5.6 | Approve, undo and commit:
<ol><li>The server sets `undo_until = now() + 4s`, and the client runs the draining bar.</li><li>Undo succeeds only while the server's `now() < undo_until`.</li><li>Commit is idempotent: it writes the `usage_ledger` consume row (`UNIQUE(application_id, kind)`) and moves the application to `handed_off`. `application:commit-expired` sweeps any that were not committed.</li><li>Handoff panel: "Open employer form ↗" as a user-gesture link, a copy panel in form order (per-field copy and "copy all"), the decrypted resume download (audited), the reply alias with its trade-off text, "I've submitted it" (moves to sent), and "Couldn't submit" (back to ready with a note).</li></ol> | tdd-guide |
| 5.7 | Reply alias `{reply_handle}+{reply_token}@{HIRELANE_REPLY_DOMAIN}`. The copy panel offers it as the email to enter. The user can opt to use their real email for one application, and the UI states the trade-off: replies won't be threaded automatically | tdd-guide |
| 5.8 | Tailoring:
<ul><li>a per-job proposal;</li><li>a validator that rejects any skill, employer, date or metric not in the base version;</li><li>a word-level diff UI;</li><li>accepting creates a child version, rendered to PDF by `resume:render` (HTML template plus Playwright Chromium in the worker).</li></ul> | tdd-guide |
| 5.9 | Never apply twice: `Idempotency-Key` on apply, approve and commit; the unique constraint; an "Already applied on {date}" state; `POST /api/applications/external` for jobs applied to elsewhere | tdd-guide |
| 5.10 | **Deep review:** PII in drafts and prompts; EEO handling and storage; authorisation on resume download; idempotency races; prompt injection in job text trying to pull other users' data or change instructions (the model gets no tools with side effects); a `no-submit-guard` audit | security-reviewer |
| 5.11 | `docs/handoff.md` (the per-ATS capability table with verification dates) and the approval state-machine diagram | doc-updater |

**Acceptance**
- [ ] During the full e2e run, the server makes **0** requests to any ATS host. This is asserted from a network log captured by an injected fetch wrapper, and `no-submit-guard` is green.
- [ ] On 30 fixture forms with an empty answer bank, 100% of visa, start-date, salary and EEO fields are Needs you.
- [ ] `pnpm agent:eval` finds 0 unsupported claims across 50 drafts, both in fixture mode and in fallback mode.
- [ ] Undo at 3.5 seconds returns the application to `ready` with 0 ledger rows. Undo at 4.5 seconds is rejected (409). Twenty parallel approve-and-commit calls produce exactly 1 application and 1 ledger row.
- [ ] Over 100 fixture tailorings, 0 contain a skill or employer absent from the base version (property test).
- [ ] The app runs on :3001. `e2e/phase-5-approve.spec.ts` passes (apply from triage, preview with Needs-you fields, fill them, approve, undo, re-approve, the handoff panel shows the copy fields and the alias), and `docs/screens/phase-5.png` (the preview with Needs-you highlighted) is saved.

---

### Phase 6: Tracker, replies, inbound email
**Goal:** replies thread deterministically onto applications, statuses update safely, and the kanban plus timeline make the search legible.

| # | Task | Agent |
|---|---|---|
| 6.1 | The `InboundMailAdapter` contract (a normalised `InboundEmail` carrying SPF and DKIM results). Adapters: `fixture` and a generic signed-JSON adapter. **The production provider is a pending decision**, recorded in `docs/email.md` | architect |
| 6.2 | Migration `0008_inbound.sql`: `inbound_messages` and `outbound_messages` with RLS; raw messages stored encrypted | tdd-guide |
| 6.3 | Webhook:
<ul><li>HMAC verification with ±5 minutes tolerance;</li><li>a unique `provider_message_id` gives replay protection;</li><li>10MB cap;</li><li>resolution order: plus-token first (`matched_by=token`), then handle plus sender-domain against the application's company or ATS sender domains, only when exactly one application matches (`domain`), otherwise unfiled in `/inbox`;</li><li>an unknown handle returns 202 and the message is dropped (no backscatter).</li></ul> | tdd-guide |
| 6.4 | Engine `replies.ts`, **test-first**: rules for acknowledgement, rejection, interview requests (scheduling links), security codes and offers, with a Haiku fallback. Transition table:
<ul><li>`ack` changes nothing;</li><li>`interview_ask` moves to interview;</li><li>`rejection` moves to rejected, filed softly;</li><li>`offer` is **suggested only** and the user confirms it;</li><li>an SPF or DKIM failure never changes status automatically.</li></ul> | tdd-guide |
| 6.5 | `mail:forward`:
<ul><li>sends only to the account's verified email (no open relay);</li><li>security-code mail is forwarded immediately and labelled, because the user may be mid-form;</li><li>HTML is sanitised and remote images stripped;</li><li>rejections go to a weekly roll-up when `quiet_rejections` is set.</li></ul> | tdd-guide |
| 6.6 | `/applications` kanban (drag plus keyboard moves, each recorded as an event), the `/applications/[id]` lane timeline and thread, `/inbox` | tdd-guide |
| 6.7 | **Deep review:** webhook authentication and replay; spoofed senders; HTML and attachment handling; alias enumeration; open-relay checks; rate limits per alias | security-reviewer |
| 6.8 | `docs/email.md`: alias format, threading rules, provider decision log | doc-updater |

**Acceptance**
- [ ] On a 25-message fixture corpus:
  - 100% of plus-token messages are filed correctly;
  - ≥ 90% are filed correctly by domain fallback;
  - **0** are misfiled across users (an RLS test).
- [ ] The reply classifier reaches ≥ 95% accuracy on a labelled 120-message set, offline.
- [ ] A bad signature returns 401. A replayed message id returns 200 and creates no duplicate row.
- [ ] In the worker test harness, forwarding p95 is ≤ 60 seconds and security codes are forwarded in ≤ 10 seconds.
- [ ] The app runs on :3001. `e2e/phase-6-tracker.spec.ts` passes (a signed fixture reply is posted, the application moves to Replied, the timeline shows the event, a drag to Interview is recorded), and `docs/screens/phase-6.png` (the kanban) is saved.

---

### Phase 7: Autopilot, digest, pricing and billing
**Goal:** a paid rule-driven drafting queue with a digest and pause link, India-first plans, enforced quotas, and stubbed payments.

| # | Task | Agent |
|---|---|---|
| 7.1 | Design:
<ul><li>plans, quota ledger and providers (Razorpay for INR, Stripe for USD, `fake` in dev);</li><li>currency comes from the user's chosen billing country, not from IP alone;</li><li>prorating mirrors the recon: an upgrade is immediate, a downgrade applies at renewal, a cancel keeps the plan to the period end.</li></ul> | architect |
| 7.2 | Engine `autopilot.ts`, **test-first**:
<ul><li>selects jobs from the rule, the matches, passes, existing applications and today's count in the user's timezone;</li><li>"my role only" means the job's role family is in the user's targets;</li><li>"not a step above me" means `max_level_delta = 0`;</li><li>every selection carries its reasons.</li></ul> | tdd-guide |
| 7.3 | `autopilot:run`, then `agent:draft` with `origin=autopilot`, then a batch, then `digest:send`:
<ul><li>the digest reads "3 drafted: 2 ready to approve, 1 needs you", with deep links and a pause link;</li><li>the pause token is single-use and hashed; GET shows a confirmation page and POST performs the pause; `List-Unsubscribe` and `List-Unsubscribe-Post` headers are set;</li><li>autopilot drafts expire after 72 hours or when the job closes.</li></ul> | tdd-guide |
| 7.4 | Migration `0009_billing.sql`. Quota is enforced at **commit** (handoff), never at draft. Free is 10 lifetime commits. When the quota is exhausted, drafting and preview keep working and handoff shows the upgrade path | tdd-guide |
| 7.5 | `/pricing` (INR/USD toggle; Indian digit grouping), `/india`, `/billing`, the checkout stub, the `/api/webhooks/razorpay` and `/stripe` handlers with signature verification and idempotency through `payment_events`. Plan seed `[assumption: price points to validate with users]`:

| Plan | INR | USD | Commits |
|---|---|---|---|
| Free | ₹0 | $0 | 10 lifetime |
| Weekly | ₹99 / week | $3 / week | 30 |
| Monthly | ₹299 / month | $9 / month | 120 |

Autopilot is included on paid plans only. | tdd-guide |
| 7.6 | Review: payment webhook signatures and replay; the quota race; pause-token security; email header injection; minimal PII in the digest | security-reviewer |
| 7.7 | `docs/billing.md`, plus a copy-honesty check: Autopilot copy everywhere says it **drafts and queues**, never "applies" or "sends" | doc-updater |

**Acceptance**
- [ ] The autopilot engine has ≥ 40 tests. A property test with random timezones and timestamps never exceeds N per day.
- [ ] 0 autopilot-origin applications reach `handed_off` without a user `approved` event (a test over 500 simulated batches).
- [ ] In fixture mode, the digest `.eml` appears in `.mail/outbox` within 2 minutes of `autopilot:run`. The pause link works once; a second use shows "already paused".
- [ ] The 11th free commit is blocked with the upgrade path. Fifty concurrent commits at the quota boundary consume exactly the remaining quota.
- [ ] Replaying a fake-provider webhook 5 times activates exactly 1 subscription.
- [ ] The app runs on :3001. `e2e/phase-7-autopilot.spec.ts` passes (set a rule of min 70, my role only, 3 per day; run a fixture ingest delta; the batch shows ready and needs-you counts; `/pricing` shows ₹ for country IN), and `docs/screens/phase-7.png` (`/autopilot`) is saved.

---

### Phase 8: Observability, privacy operations, hardening
**Goal:** freshness and error budgets are visible, PII lifecycle obligations are automated, and the product is launch-ready.

| # | Task | Agent |
|---|---|---|
| 8.1 | SLO definitions:
<ul><li>freshness ≥ 95% of open jobs seen within 7 hours;</li><li>closure lag p95 ≤ 13 hours;</li><li>source fetch success ≥ 99% over 7 days, which defines the error budget;</li><li>queue wait p95 < 2 minutes;</li><li>alert when the burn rate is > 2× over both 1 hour and 6 hours.</li></ul> | architect |
| 8.2 | `/ops` (runs and per-source sparklines for success, counts, latency and bytes), `/ops/sources/[id]`, `/ops/slo` (budget remaining, burn rates, stale or failing sources, LLM spend by purpose, queue depth). Public `/status` shows freshness and "partial" states only | tdd-guide |
| 8.3 | `ops:freshness` writes `slo_snapshots` and sends alert email (outbox in dev). A fault-injection flag `HIRELANE_FAULTS=board:500:<token>` drives tests | tdd-guide |
| 8.4 | `retention:purge` (§10 schedule); `/settings/privacy` export (zip) and account deletion (password re-confirm, immediate session revocation, blob deletion) | tdd-guide |
| 8.5 | Structured logs (pino) with a redaction list. `audit_log` entries for resume downloads, EEO views, admin views, exports and deletes. A log PII scanner test runs over the full e2e log output | tdd-guide |
| 8.6 | Performance and accessibility pass: board benchmark, axe on every page, keyboard-only e2e for triage and approval, a reduced-motion snapshot | tdd-guide |
| 8.7 | **Pre-launch review:**
<ul><li>an OWASP ASVS L2 subset checklist;</li><li>CSP with nonces, HSTS and `frame-ancestors 'none'`;</li><li>`pnpm audit --prod`;</li><li>a secrets scan;</li><li>key rotation for `HIRELANE_MASTER_KEY` (re-wrap the data keys);</li><li>a restore drill.</li></ul> | security-reviewer |
| 8.8 | Runbooks `docs/runbooks/{ingest-failing,inbound-down,llm-outage,key-rotation}.md` and a full codemap refresh | doc-updater |

**Acceptance**
- [ ] Error-budget maths matches a hand-computed fixture to 0.1 percentage points (unit test). `/ops` shows the last 28 runs.
- [ ] Faulting 10 boards across 3 runs shows budget burn on `/ops/slo` and "partial" on `/status`, and closes **0** of those boards' jobs.
- [ ] The log PII scan finds 0 hits for any fixture email, phone number or resume name.
- [ ] The export's per-table row counts equal the database's for that user. After deletion, 0 rows and 0 blobs remain for the user across all user tables.
- [ ] axe reports 0 serious or critical violations on 20 pages. `pnpm audit --prod` reports 0 high or critical.
- [ ] The app runs on :3001. `e2e/phase-8-ops.spec.ts` passes, and `docs/screens/phase-8.png` (`/ops/slo`) is saved.

---

### Phase 9 (LATER, feature-flagged): headless submission
**Goal:** optional real submission for an ATS **only** if its terms permit it. It requires explicit per-application approval and is off by default everywhere. Autopilot can **never** trigger it.

| # | Task | Agent |
|---|---|---|
| 9.1 | Per-ATS terms review checklist `docs/legal/ats-terms.md` (clauses, dates, decision, human or legal sign-off). If a provider's terms prohibit automated submission, that ATS stays handoff-only. Note: posting applications through an ATS board API usually needs an employer-held key `[assumption]`, so the only route is a browser, which raises the terms risk | planner |
| 9.2 | Isolation design:
<ul><li>`packages/agent/src/submit/` as a separate entry point;</li><li>a dedicated `submit` queue with concurrency 1 per host;</li><li>a sandboxed Playwright container;</li><li>the approval record binds a hash of the exact answers and resume, plus the click text "Submit to {employer} on my behalf now";</li><li>enabling requires **all of**: env `HIRELANE_ENABLE_SUBMIT=1`, a `feature_flags` row, the user's opt-in, and the ATS being allowlisted after 9.1.</li></ul> | architect |
| 9.3 | Per-ATS submitters, tested **only** against local mock ATS pages in `e2e/mocks/ats/*`. Confirmation detection stores an encrypted evidence screenshot. On an email OTP the run pauses and the user is asked (reading codes from alias mail automatically requires a separate explicit opt-in) | tdd-guide |
| 9.4 | Review: sandbox escape, flag-bypass attempts, approval-hash binding, credential handling, rate limits | security-reviewer |
| 9.5 | `docs/submit.md`, and terms status shown in-product next to each ATS | doc-updater |

**Acceptance**
- [ ] With the flag off (the default in every environment), no `submit` workers are registered and the submit endpoints return 404. `no-submit-guard` allows matches only inside `packages/agent/src/submit/`.
- [ ] Against the mock ATS, submission proceeds only when the approval hash matches the current answers, and any edit after approval invalidates it (test).
- [ ] Each ATS enabled outside local development has a signed-off entry in `docs/legal/ats-terms.md`.
- [ ] The app runs on :3001. `e2e/phase-9-submit-mock.spec.ts` passes, and `docs/screens/phase-9.png` is saved.

---

## 10. Privacy, security & legal guardrails

**Resume PII**
- **At rest:**
  - Files and sensitive answers are encrypted with AES-256-GCM using envelope keys. The `HIRELANE_MASTER_KEY` comes from the environment and is never committed; `pnpm setup:keys` generates it for dev.
  - Files live under `storage/` (gitignored).
  - Downloads are authorised, streamed and audited.
- **Isolation:**
  - All user tables use FORCE RLS through `withUser`.
  - `withAdmin` is reserved for ingest and ops.
  - `verify-rls` runs on every `pnpm verify`.
- **LLM boundary:**
  - Contact details are extracted deterministically and redacted before any model call.
  - Only the fields a task needs are sent.
  - Job text is delimited as untrusted.
  - Models get no side-effecting tools.
  - Outputs are schema-validated and evidence-checked.
  - `llm_calls` never stores content.
- **Logs:** pino redaction paths cover email, phone, resume text, answers and inbound bodies. A CI scan of e2e logs must find 0 PII hits.
- **Repository:** synthetic resumes only. Never commit a real person's CV, and never commit real inbound mail.
- **Retention:**

  | Data | Retention |
  |---|---|
  | Raw inbound mail | 90 days |
  | EEO answers | Deleted at commit unless `eeo_retain` |
  | Expired sessions | Daily |
  | Idempotency keys | 24 hours |
  | Deleted accounts | Hard delete immediately; backups roll off within 30 days |

- **Data subject rights:** export and deletion in-product. An explicit consent screen at upload says the resume leaves Hirelane only when the user hands off a specific application.
- **Jurisdiction:** India DPDP Act 2023 and GDPR basics apply `[assumption: needs legal review before launch]`. Publish a privacy notice and a subprocessor list (LLM provider, email, payments). Never sell or share data.

**Email**
- Inbound webhooks are signed and replay-proof, with a size cap.
- HTML is sanitised, remote images stripped, and attachments encrypted.
- Mail is forwarded only to the account's verified email (no open relay).
- SPF and DKIM failures never change application status automatically.

**Auth and payments**
- scrypt passwords and opaque revocable sessions with `__Host-` cookies.
- Rate-limited login with enumeration-safe errors.
- Payment webhooks verify signatures and are idempotent by event id.
- Quotas are protected by a unique ledger constraint.

**Ingest ethics and ATS terms**
- Jobs come **only** from Greenhouse boards-api, Lever v0 postings and Ashby posting-api.
- **Never** scrape shortlistapp.co, LinkedIn or any HTML career page.
- Identify ourselves with a UA and contact address. Keep to 1 request per second per host. Back off on 429.
- Board tokens come from config only.
- Honour employer opt-out through `/contact`, which sets `company_boards.enabled=false` within 48 hours.
- Show employer descriptions verbatim with attribution and the original link. Closed jobs drop out of the sitemap and feeds; their pages show "Closed on {date}" with `noindex`, and return 410 after 30 days.
- Whether third-party aggregation is permitted under each provider's terms is **an open checklist item with human sign-off before public launch** `[assumption]`.

**No auto-submit in the MVP**
- Hirelane never POSTs to an employer or ATS application endpoint. This is enforced by `no-submit-guard` and the e2e network assertion.
- Autopilot drafts and queues; a human approves and opens every form.
- Headless submission exists only in Phase 9, behind four independent switches, with per-application approval bound to an answers hash, and never from Autopilot.

**Honesty rules**
- An unparsed salary is absent, never estimated.
- Ineligibility is explained.
- The salary floor never leaves the user's feed.
- Social-proof numbers are live database queries with an as-of date, or they are not shown.
- No Shortlist or Pip references anywhere in the product (`brand-guard`).

---

## 11. Definition of done

**Product**
- [ ] The public board, job pages, company pages, SEO lists, public API, `llms.txt`, markdown negotiation and sitemap index are live on :3001 from fixture data offline, and from live ATS APIs when `HIRELANE_INGEST_MODE=live`.
- [ ] The full loop is demonstrable in one e2e run with no API key: upload resume, explained matches, triage, drafted preview with Needs you, approve, 4-second undo, handoff with copy panel and alias, reply threaded, kanban updated.
- [ ] Autopilot drafts by rule and sends a digest with a working pause link. Quotas are enforced, and INR/USD pricing is shown correctly.

**Quality gates**
- [ ] `pnpm verify` is green: tests, typecheck, `lint:deps`, `brand-guard`, `no-submit-guard`, `db:verify-schema`, `db:verify-rls`, `db:verify-auth`.
- [ ] `pnpm engine:eval` and `pnpm agent:eval` meet every threshold in Phases 2, 5 and 6. `pnpm report:coverage` is published in `docs/enrichment.md`.
- [ ] All phase specs `e2e/phase-0…8-*.spec.ts` pass. `docs/screens/phase-0.png` through `phase-8.png` are committed and reviewed against §4.1: no banned trope is present.
- [ ] Board p95 ≤ 300ms and API p95 ≤ 150ms on the full fixture. axe reports 0 serious or critical violations. `pnpm audit --prod` reports 0 high or critical.

**Security and legal**
- [ ] `security-reviewer` has signed off every phase before push, with deep reviews in Phases 4, 5, 6 and 8.
- [ ] The privacy notice, subprocessor list, retention jobs, export and delete are all in place. The ATS terms checklist has human sign-off before any public deploy.
- [ ] Every `[assumption]` in this plan is either verified (tag updated, with a date) or explicitly accepted as a known risk in `docs/architecture.md`.

**Docs**
- [ ] `README.md` "Running it" works verbatim on a clean machine.
- [ ] These docs are current, maintained by `doc-updater`:
  - `docs/architecture.md`, `ingest.md`, `enrichment.md`, `matching.md`, `handoff.md`, `email.md`, `billing.md`, `public-api.md`, `privacy-model.md`
  - the runbooks
  - the codemap
