# Hirelane: final PRD

Version 1.0, 2026-10-21. Built from FINAL-BUSINESS.md (the why), PLAN.md (phases, data model, API; still binding where not overridden), docs/mocks/README.md (approved UI: Wrapped; genz-a-hubs-states and genz-a-detail) and the audit (docs/audit/AUDIT-2026-10-17.md).
Status per requirement: shipped / partial / todo. Release: R0 / R1 / R2 / R3.

## 1. Goal and scope
**Goal:** a fresher goes from "I need a job" to "a human replied", with the fewest typed fields and nothing sent that they didn't read.
**Core loop (the product and the revenue):**
1. picks
2. fit
3. check
4. hand-off to the employer's form (the user submits)
5. tracker

**Plus layer:** background agent, referral finder, founder outreach drafts.

**Non-goals:**
- Hirelane submitting applications or sending messages
- scraping LinkedIn, Indeed, Naukri, Tsenta or any aggregator
- an employer ATS
- AI that invents experience
- desktop power-user tooling as the product

## 2. Personas
- **Asha:** final-year CS, BITS Pilani, SDE/data roles, Bengaluru or remote, phone-first. (Labelled sample.)
- **Rahul:** B.Com, tier-3 college, 6 months out, ops/sales/support roles, price-sensitive, no network.
- **Priya:** 1.5 years in QA, switching to SDE, remote. Needs the gap plan.
- **Placement officer:** wants off-campus outcomes per student without spreadsheets.

## 3. Requirements

### A. Supply and data
| ID | Requirement | Acceptance | Rel | Status |
|---|---|---|---|---|
| A1 | Public board with search and filters (role, level, country, remote, workplace, pay-stated, minimum pay INR/USD, posted-within) | as PLAN §7.1 | R0 | shipped |
| A2 | Source and freshness line on every card and page ("<company> careers page · read 2h ago") | visible on card, job, company | R0 | partial |
| A3 | Honest pay: shown only when parsed, with its trace; `salary_stated` false when no amount was parsed | 0 rows stated=true with null amounts | R0 | partial (bug) |
| A4 | Fresher flag: level intern/entry, or "0–2 yrs / fresher / new grad" in the text; evidence stored | labelled sample of 200, precision ≥ 95% | R0 | todo |
| A5 | Board discovery: company lists → candidate tokens → probe public Greenhouse/Lever/Ashby endpoints → `company_boards` with `verified_at` | 1,000 companies R0; 3,000 R1; 10,000 R2 | R0–R2 | todo |
| A6 | More public ATS connectors (SmartRecruiters, Workable, Recruitee, Teamtailor, Personio, BambooHR; India: Darwinbox, Keka, Zoho Recruit, Freshteam), each verified for public access and terms before merge | a verification note per connector in docs/recon | R1–R2 | todo |
| A7 | Skill quality: drop soft skills from chips; tag a skill only if the text contains it or an alias; map to ESCO/O*NET ids | < 5% wrong tags on a 200-job sample | R0 | todo |
| A8 | Worthwhile role, per user and job: open and read ≤ 7 days; fresher-eligible; role and city match; ≥ 60% must-haves with evidence; not seen or applied; no flagged blocker. Every pick stores which conditions passed | weekly report per profile × city feeds gate G0 | R0 | todo |
| A9 | Closed roles are soft-closed, hidden from picks, and shown as "Gone" in saved and tracker | — | R0 | partial |
| A10 | Never scrape aggregators or competitors; only public ATS APIs. Enforced by a source allowlist in `packages/ingest` | CI check fails on a non-allowlisted host | R0 | todo |

### P. Performance and caching
| ID | Requirement | Acceptance | Rel |
|---|---|---|---|
| P1 | `job_cards` hot table: card fields only, plus `tags text[]` (`role:`, `level:`, `city:`, `remote:`, `pay:`, `fresher:`, `company:`), GIN index; written at enrich finalize | board query never touches `jobs.description_*` or traces | R0 |
| P2 | Per-tag top-100 cache: `tag_top(tag, rank, job_id)` plus a Valkey/Redis key `tag:{tag}`, for every tag and common pairs (role×city, role×level); rebuilt at finalize; cache miss falls back to SQL | first board page p95 < 150 ms server | R0 |
| P3 | Facets from `job_facets` (materialized view), not computed per request; total count from the view or estimated | no `count(*)` over the filtered CTE on default pages | R0 |
| P4 | Keyset pagination (posted_at, id) instead of OFFSET | page 50 as fast as page 1 | R0 |
| P5 | Picks precomputed per user after each enrich (`match:user-delta`) into `daily_picks` | opening picks p95 < 100 ms | R1 |
| P6 | Queue hygiene: batch enrich per board, `job_key` dedupe, a separate LLM queue with concurrency ≤ N, retries with backoff, a dead-letter view on /ops | ingest-to-cards lag p95 < 30 min | R0 |
| P7 | pg_stat_statements on, statement_timeout 2s for web, slow-query log | top 10 queries visible on /ops | R0 |
| P8 | Search-as-you-type from cache (prefix over titles and companies); Meilisearch/Typesense only if P1–P4 miss target | p95 < 50 ms | R1 |

### K. Knowledge graph (Postgres tables)
| ID | Requirement | Rel |
|---|---|---|
| K1 | Skill graph: `skills` (ESCO/O*NET ids), `skill_edges(from, to, kind: alias / adjacent / parent)` | R1 |
| K2 | Job ↔ skill edges from `job_requirements` (must/nice), with weights | R1 |
| K3 | Adjacent-skill partial credit in match ("~ Kubernetes: you have Docker"), shown, never a hidden ✓ | R1 |
| K4 | Gap engine: across a user's last 30 picks, the skill whose addition unlocks the most worthwhile roles | R2 |
| K5 | Company graph: momentum (weekly new roles), fresher share, cities | R1 |
| K6 | Private contact edges (contact works at company) per user, FORCE RLS, never cross-user | R2 |
| K7 | Outcome aggregates (reply rate by company × college tier) only from our own users, with consent and a minimum k of 10 | R3 |

### B. Account and resume
| ID | Requirement | Rel |
|---|---|---|
| B0 | Waitlist (email, grad year, consent), same-origin, rate-limited, fails closed. Status: built on `fix/audit-p1` | R0 |
| B1 | Sign-up by phone OTP or Google (overrides PLAN §7.2 password; email kept for replies) | R1 |
| B2 | Resume upload: PDF ≤ 5 MB, magic-byte check, envelope-encrypted, never logged; parsed with pdf text plus rules first, LLM only with consent | R1 |
| B3 | LLM consent toggle, off by default | R1 |
| B4 | Resume versions (≤ 3) | R2 |
| B5 | Delete everything within 24h; export | R1 |
| B6 | Privacy page, terms, contact and grievance officer before any resume upload | R0 |

### C. Picks and swipe
| ID | Requirement | Rel |
|---|---|---|
| C1 | Daily picks: up to 5 at 9:00 IST, only worthwhile roles (A8), from P5 | R1 |
| C2 | Pick card (mock genz-a-detail #2): logo, source line, title, city, experience band, match ring, top 3 ✓ with evidence, top 1 ✕, honest pay line; no soft-skill chips | R1 |
| C3 | Gestures with a button for each: right = get ready, left = skip, tap = details, long-press = save; keyboard arrows plus Space; no single-letter global shortcuts | R1 |
| C4 | Skip reason, 1 tap (city, role, too senior, pay, other); feeds ranking | R1 |
| C5 | Match explanation: weighted must-haves, nice-to-haves, level and city fit; each line quotes the posting and resume spans; no evidence = ✕ or ~ | R1 |

### D. Fill, check and hand-off
| ID | Requirement | Rel |
|---|---|---|
| D1 | Deterministic field mapping per ATS (Greenhouse, Lever, Ashby first); LLM only for free-text answers, cached per question; ≤ ₹0.3 per hand-off | R1 |
| D2 | Needs you: visa, start date, salary expectation, EEO, notice period, and low-confidence answers are never auto-filled; approval blocked until answered | R1 |
| D3 | Check screen (mock #4): every answer with its source, resume version, Needs-you in pink; CTA "Open <company>'s form, filled" | R1 |
| D4 | Hand-off: employer URL, prefill where verified, otherwise a copy panel with one-tap copy per field; designed for phone (mock #5) | R1 |
| D5 | 4-second server-side undo; idempotency key; `UNIQUE(user, canonical_job)` | R1 |
| D6 | "Did you submit?" (Yes / Not yet / Couldn't) drives tracker state; "Couldn't" captures the reason (gate G3 data) | R1 |

### E. Tracker and replies
| ID | Requirement | Rel |
|---|---|---|
| E1 | States: ready → handed off → submitted → replied → interview → offer, or "not this time"; each timestamped | R1 |
| E2 | Reply threading by opt-in plus-address; rejections filed quietly | R2 |
| E3 | "Quiet 6 days" follow-up draft (the user sends it) | R2 |

### F. Engagement (Gen-Z layer)
| ID | Requirement | Rel |
|---|---|---|
| F1 | Home: greeting, streak, company stories with new-role counts (from P2), picks tile with contents and ETA, timestamped "while you slept" rows | R1 |
| F2 | Follow a company → its new roles become stories | R1 |
| F3 | Weekly recap, Sunday 7 pm, shareable 9:16 image with a referral link, honest counts | R2 |
| F4 | Streaks never shame; Pause mode (exams) | R2 |
| F5 | WhatsApp 9 am picks via the official Cloud API, opt-in | R2 |

### G. Monetisation
| ID | Requirement | Rel |
|---|---|---|
| G1 | Free: 3 hand-offs a week with a visible counter | R1 |
| G2 | Passes: 30-day ₹249 and season ₹499 via Razorpay (UPI, card), no auto-renew by default; Stripe for USD | R1 pilot |
| G3 | Paywall on the check screen of the 4th hand-off in a week (high-match role) and after the first employer reply; never mid-form | R1 |
| G4 | Campus codes unlock passes for a cohort; cohort dashboard | R2 |

### X. Plus agents
| ID | Requirement | Rel |
|---|---|---|
| X1 | Background agent: after each ingest, re-scores the user's tags; new worthwhile roles appear as picks or a WhatsApp nudge; nothing is sent | R2 |
| X2 | Chat onboarding (WhatsApp or in-app): a 5-question conversation that fills profile and preferences; the user confirms each field | R2 |
| X3 | Referral finder: import Connections.csv, vCard or manual; "You know N here"; warmth equation (docs/network-plan.md); draft the ask; the user sends it | R2 |
| X4 | Founder outreach drafts (UC8) for startups with no open role: signals from public sources only (careers page with no roles, public funding news the user links); a draft citing resume evidence; the user sends it; limit 3 a week | R2 |
| X5 | Agent cost caps per user per day; every LLM call logged without content | R2 |

### H. Trust
| ID | Requirement | Rel |
|---|---|---|
| H1 | Copy guard: marketing claims map to shipped flags; CI fails on an unmapped claim | R0 |
| H2 | Remove the remaining overclaims in the footer and mobile menu ("You approve every application") | R0 |
| H3 | "What Hirelane never does" card in You | R1 |

## 4. Screens (approved style; build from the mocks)
| Screen | Mock | Rel |
|---|---|---|
| Landing: playable loop on real roles, waitlist | redo in the Wrapped style (genz-a-landing is unreviewed) | R0 |
| Onboarding: resume → preferences → rules | genz-a-more | R1 |
| Home | genz-a-detail #1, hubs-states | R1 |
| Picks: rest, drag, skip reason | detail #2–3, genz-a-swipe | R1 |
| Check | detail #4 | R1 |
| Hand-off + undo | detail #5 | R1 |
| Job detail | detail #6 | R1 |
| Company | detail #7, hubs-states | R1 |
| Discover (search, filter sheet) | hubs-states | R1 |
| Tracker | detail #8 | R1 |
| You (rules, resumes, pause, never-does) | detail #9 | R1 |
| Recap | detail #10 | R2 |
| Settings, privacy, delete | — | R0–R1 |

Tabs: Home · Discover · Companies · Tracker · You.

## 5. Non-functional requirements
- **Performance:** P1–P8 targets; LCP < 2.5s on a mid-range Android over 4G; hero images ≤ 150 KB on mobile.
- **Accessibility:** WCAG 2.2 AA; a button for every gesture; reduced motion; text contrast ≥ 4.5:1 (no small coloured text on pink or lime).
- **Privacy:** DPDP 2023; envelope encryption (`HIRELANE_MASTER_KEY`); no PII in logs (CI scan with synthetic fixtures); deletion within 24h.
- **Security:**
  - session auth on every user route
  - per-user and per-IP limits with `TRUST_PROXY_HOPS` set in deploy (audit SEC-1)
  - same-origin checks on mutations
  - signed webhooks
- **Reliability:** ingest every 6h; `/status` freshness; CI runs `pnpm verify` plus e2e on every PR.
- **Cost:** ≤ ₹0.3 LLM per hand-off; per-user daily agent cap.

## 6. Metrics and instrumentation (PostHog or Umami from R0)
- **Funnel events:**
  - visit
  - waitlist
  - activated
  - first swipe
  - right-swipe
  - check opened
  - hand-off
  - "did you submit" answer
  - reply
  - pass bought
  - recap shared
- **Gate data:**
  - worthwhile share per pick
  - minutes per application
  - "Couldn't submit" reasons
  - outcomes by college tier
- **Guardrails:**
  - 0 sends by Hirelane
  - 0 Needs-you auto-filled
  - 0 cross-user contact exposure

## 7. Releases
- **R0 (2 weeks):**
  - B0, B6, H1, H2 (trust)
  - A3, A4, A7, A8, A10 (data)
  - A5 v1 (1,000 companies)
  - P1–P4, P6, P7 (speed)
  - CI
  - Wrapped landing
  - gates G0–G3
- **R1 (6 weeks):**
  - B1–B3, B5
  - C1–C5, D1–D6, E1, F1, F2, G1–G3, H3
  - K1–K3, K5
  - P5, P8
  - A5 to 3,000 companies
  - 2-campus pilot under the stop rules in FINAL-BUSINESS §11
- **R2 (12 weeks):** B4, E2, E3, F3–F5, G4, K4, K6, X1–X5, A6, 10,000 companies.
- **R3:** employer Fresher Drop, paid API/MCP, K7.

## 8. Open decisions
1. Scenario B or C, and the B2C cash ceiling.
2. Pass prices.
3. OTP vendor (MSG91 / Firebase / Twilio).
4. Cache: Valkey in-process host, or managed Redis.
5. Meilisearch: now or only if P targets miss.
6. Privacy contact and grievance officer.
7. Prefill support per ATS: verify Greenhouse, Lever and Ashby query parameters.
