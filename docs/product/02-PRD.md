# Hirelane: PRD

Written 2026-10-19. Read with 00-PLATFORMS.md, 01-BUSINESS.md (use cases UC1–UC7), PLAN.md (incl. Amendment A), docs/network-plan.md, (scope and acceptance), docs/mocks/README.md (approved UI) and docs/audit/AUDIT-2026-10-17.md (current state).
Requirement IDs are stable; status is one of shipped / partial / todo, judged against the audit.

## 1. Goal
Get a fresher from "I need a job" to "a human replied", with the fewest typed fields and nothing sent that they didn't read. The core loop (picks → fit → fill → user submits → tracker) is the product and the revenue; network/referrals (section N) support it.
Use-case coverage: UC1 (off-campus hunt), UC2 (referral finder), UC3 (internships) and UC4 (close the gap) are in scope for R1–R2. UC5 (campus), UC6 (employers) and UC7 (API) are R3+ and only stubbed here.

## 2. Non-goals (this year)
- Submitting applications for the user (CLAUDE.md: hand-off only; headless submission is a later, flagged phase)
- Scraping LinkedIn, Indeed, Naukri or any non-public source
- An employer ATS
- Resume writing from scratch, or any AI text that invents experience
- Desktop-first power-user tools (the ledger board stays, but it isn't the product)

## 3. Personas
- **Asha (primary):** final-year CS at BITS Pilani, graduating 2026. Wants SDE, data or product roles in Bengaluru or remote. On her phone between classes. Has one internship. (Labelled sample, PLAN.md.)
- **Rahul:** B.Com grad from a tier-3 college, 6 months out. Wants ops, sales or support roles. Price-sensitive (UPI weekly pass). Hindi-English. Has no network.
- **Priya:** 1.5 years as a QA engineer, wants to switch to SDE, remote. Needs the "close the gap" plan more than volume.
- **Placement officer (later buyer):** wants to see which students applied where and the outcomes, without spreadsheets.

## 4. Core loop (the product)
1. Add resume once.
2. Get today's 5 picks.
3. Swipe: right = get it ready, left = skip with a reason.
4. Check the filled answers; answer any Needs-you.
5. Open the employer form, filled; the user submits.
6. 4-second undo; the item lands in the tracker.
7. Replies are threaded.
8. Weekly recap.

## 5. Functional requirements

### A. Board and data (supply)
- **FR-A1 Public board.** Search plus filters (role, level, country, remote, workplace, pay-stated, minimum pay INR/USD, posted-within). Status: shipped.
- **FR-A2 Source line.** Every job card and page shows the source ("<company> careers page") and "read Xh ago". Status: partial ("Last checked" exists on the job page only).
- **FR-A3 Honest pay.** Pay is shown only when parsed, with its trace. "Pay not stated" otherwise. `salary_stated` must be false when no amount was parsed. Status: partial (bug: stated=true with null amounts on Rubrik/GitLab).
- **FR-A4 Fresher signal.** `level ∈ {intern, entry}` or an explicit "0–2 yrs/fresher/new grad" phrase gives a `fresher_friendly` flag with evidence. Status: todo.
- **FR-A5 India supply.** Add public sources for India-heavy ATSs and a curated list of 300+ India fresher-hiring companies. Acceptance: ≥ 1,500 open entry/intern roles in India or remote-India. Status: todo (75 today).
- **FR-A6 Skill quality.** Drop soft skills from chips (collaboration, communication, attention-to-detail…). Only tag a skill if the posting text contains it or a known alias. Acceptance: < 5% wrong tags on a 200-job labelled sample. Status: todo.
- **FR-A8 Worthwhile role.** Implements the definition in 01-BUSINESS §6.1. Every pick stores which conditions passed. A weekly report per profile × city feeds gate G0 and the 80% stop rule.
- **FR-A7 Closed roles.** Soft-close, hide from picks, and show "Gone" in saved/tracker. Status: partial.

### B. Account and resume
- **FR-B1 Sign up.** Phone OTP or Google. PLAN.md §7.2 specifies email plus scrypt password: decide (see §10). Status: todo (the audit's UX-1 dead end).
- **FR-B2 Waitlist capture now.** Until B1 ships, every "Start free" goes to a working waitlist (email or phone, college, grad year). Status: todo (P1 fix).
- **FR-B3 Resume upload.** PDF ≤ 5 MB, encrypted at rest, never logged. Parsed into a profile (education, skills, projects, internships, links) the user can edit. Status: todo.
- **FR-B4 LLM consent toggle.** Off by default. Without it, matching is deterministic only and drafting is limited to profile fields. Status: todo.
- **FR-B5 Resume versions.** Up to 3 (e.g. SDE-first, Data-first), with one chosen per application. Status: todo.
- **FR-B6 Delete everything.** One tap deletes the account, resumes and applications within 24h (DPDP). Status: todo.

### C. Picks and swipe
- **FR-C1 Daily picks.** 5 a day by default (rule-editable 3–15), ranked by match. Excludes skipped, applied and closed roles. Refreshed at 9:00 IST. Status: todo.
- **FR-C2 Pick card.** Logo, company, source line, title, city/remote, experience band, match ring, the top 3 ✓ with evidence, the top 1 ✕ said plainly, and an honest pay line. No soft-skill chips. (Mock: genz-a-detail screen 2.)
- **FR-C3 Gestures.** Swipe right = get ready, left = skip, tap = details, long-press = save. Buttons for every gesture. Keyboard: arrows plus Space; no single-letter global shortcuts (WCAG 2.1.4, audit FE-4).
- **FR-C4 Skip reason.** After a left swipe, an optional 1-tap reason (wrong city, not my role, too senior, pay). Feeds ranking.
- **FR-C5 Match explanation.** The score = weighted must-haves met, plus nice-to-haves, plus level/location fit. Each line quotes the posting span and the resume span. A line without resume evidence is a ✕ or a "~", never a ✓.
- **FR-C6 Close the gap.** On jobs with 1–2 missing must/nice items, suggest one concrete action with a time estimate. Status: todo (v2).

### D. Fill, check and hand-off
- **FR-D1 Draft answers.** For the target ATS (Greenhouse, Lever and Ashby first), map known fields from the profile. Every drafted answer stores its source span.
- **FR-D2 Needs you.** Visa, start date, salary expectation, EEO, notice period, and any low-confidence answer are never auto-filled. Approval is blocked until they're answered.
- **FR-D3 Check screen.** Shows every answer and its source, the resume version (swappable), and Needs-you in pink. The CTA reads "Open <company>'s form, filled".
- **FR-D4 Hand-off.** Opens the employer's real URL. Uses URL prefill where verified for that ATS; otherwise a copy-answers panel with one-tap copy per field. The user submits there.
- **FR-D5 Undo.** 4-second server-authoritative undo after approval. Idempotency key; `UNIQUE(user, canonical_job)`.
- **FR-D6 Confirmation.** After hand-off, ask "Did you submit?" (Yes / Not yet / Couldn't). The tracker state depends on the answer, so we never claim an application we can't see.

### E. Tracker and replies
- **FR-E1 Tracker.** States: ready → handed off → submitted (user-confirmed) → replied → interview → offer, or "not this time". Each step is timestamped.
- **FR-E2 Reply threading.** A per-application plus-address goes into the form's email field only with the user's opt-in, otherwise the user's own email is used. Inbound replies are filed on the application and forwarded. Rejections are filed quietly.
- **FR-E3 Nudges.** "Quiet 6 days" gets a follow-up suggestion (draft only, the user sends).

### F. Engagement (Gen-Z layer)
- **FR-F1 Home.** Greeting, streak, company stories from followed companies (new roles count), the picks tile with its contents and ETA, and "While you slept" activity rows.
- **FR-F2 Follow companies.** New roles appear as stories.
- **FR-F3 Weekly recap.** Sunday 7 pm: forms filled, replies, average minutes per application, best match. Shareable 9:16 image with a referral link. Honest counts only.
- **FR-F4 Streaks.** Days with ≥ 1 swipe. Never shame-messaged. A "Pause" mode (exams) freezes the streak and picks.
- **FR-F5 WhatsApp picks (opt-in).** 9 am message with 5 picks; tapping deep-links into the app. Status: v2.
- **FR-F6 Alumni intros.** Moved to section N.

### N. Network and referrals (UC2, supporting; R2 Plus feature; Amendment A, docs/network-plan.md)
- **FR-N1 Contact import.** Sources, user-provided only: LinkedIn Connections.csv export, vCard/CSV, manual add (Google Contacts OAuth later). Parsed in the worker, encrypted, per-user FORCE RLS. Status: todo.
- **FR-N2 Separate consent.** A "use my contacts in drafts" toggle, separate from the resume LLM consent. Off means warmth is still shown, but no draft quotes a contact. Status: todo.
- **FR-N3 Company match.** Contacts are matched to companies by current-company name or domain, through canonical companies. Confidence is shown; the user confirms ambiguous matches. Status: todo.
- **FR-N4 Warmth.** A ported WarmPath formula (same college plus batch, worked together, recency, your one-key rating), shown as its equation. v1 is first-degree only; no two-hop paths and no cross-user aggregates, ever. Status: todo.
- **FR-N5 Surfaces:**
  - "You know N here" on the pick card, job page, company page and board (signed-in)
  - a strongest-contact row
  - a "has a contact" filter
  - a "match, then warmth" sort
  - Status: todo.
- **FR-N6 Referral ask draft.** For a job plus a contact: a short message citing the role link and 1–2 resume facts, run through the evidence validator (no invented claims). It follows approve, 4s undo, then copy and open (WhatsApp, LinkedIn or email). Hirelane never sends it. Status: todo.
- **FR-N7 Follow-up.** The tracker records "asked Meera · Tue" and nudges after 4 days (draft only). Status: todo.
- **FR-N8 Campus alumni (UC5, R3).** Alumni lists uploaded by a partner college, used only for that college's students, with the college's data agreement. Status: later.
- **Acceptance:**
  - Importing a 2,000-row Connections.csv takes < 30s.
  - No contact data appears in logs (PII log scan includes a synthetic contact fixture).
  - Delete-account removes contacts, imports and drafts.

### G. Monetisation
- **FR-G1 Free plan.** 3 hand-offs a week. A counter is visible; no card needed.
- **FR-G2 Passes.** 30-day ₹249 and season (90-day) ₹499 via Razorpay (UPI and card); no auto-renew by default; Stripe for USD. The paywall shows on the check screen of the 4th hand-off in a week, on a high-match role, and after the first employer reply; never mid-form.
- **FR-G4 Cost per hand-off.** Field mapping is deterministic. The LLM is used only for free-text answers, cached per question. Target ≤ ₹0.3 per hand-off, logged in llm_calls.
- **FR-G3 Campus codes.** A code unlocks Plus for a cohort; the cohort dashboard is v3.

### H. Trust and honesty
- **FR-H1 Copy guard.** Marketing pages may only describe shipped features (audit UX-2). Add a CI check listing claim → feature flag.
- **FR-H2 "Never does" card** in You: submits for you, guesses pay, invents answers, sells data.
- **FR-H3 Legal pages.** Privacy, terms, contact and grievance officer (DPDP) before any resume upload (audit UX-9).

## 6. Screens (approved style: Wrapped, see docs/mocks/genz-a-detail.html)
Tabs: Home · Discover · Companies · Tracker · You. Network lives inside You and the job and company pages from R2 (Plus).
| Screen | Purpose |
|---|---|
| Landing | the playable loop on real roles, waitlist capture |
| Onboarding (resume, then preferences, then rules) | |
| Home | |
| Picks/swipe (rest, drag, skip reason) | |
| Check | |
| Hand-off plus undo | |
| Job detail | why it fits, honest bits, close the gap |
| Company | momentum, counts, people, roles |
| Discover | search with live counts, filter sheet |
| Tracker | |
| You | profile progress, rules, resumes, pause, never-does |
| Recap | |
| Settings / privacy / delete | |

## 7. Non-functional requirements
- **Performance:** picks load in < 1.5s p75 on a mid-range Android over 4G. LCP < 2.5s on landing. Hero images ≤ 150 KB on mobile (audit FE-2).
- **Accessibility:** WCAG 2.2 AA. Every gesture has a button. Respect reduced motion. Contrast ≥ 4.5:1 for text under 18px (no small coloured text on pink/lime).
- **Privacy:** DPDP 2023. Resumes encrypted (envelope key, `HIRELANE_MASTER_KEY`). PII never in logs. An LLM call only happens with consent. Deletion within 24h.
- **Security:** auth on every user route; rate limits per user and per IP with the trusted proxy configured (audit SEC-1); idempotent writes; ops routes token-guarded.
- **Reliability:**
  - Ingest every 6h, with freshness on `/status`.
  - Picks job is idempotent.
  - CI gate: `pnpm verify` plus e2e on every PR (audit: no CI today).
- **Cost:** LLM spend per hand-off is logged in `llm_calls` and alerts above ₹2.

## 8. Metrics (instrument from day 1)
- activation (resume added)
- first swipe
- swipes per session
- right-swipe rate
- check → hand-off conversion
- "did you submit" yes-rate
- reply rate
- D1 / D7 / D30 retention
- recap share rate
- referral installs
- Plus conversion
- Guardrails:
  - Needs-you auto-fills = 0
  - complaints about wrong applications = 0

## 9. Release plan
- **R0, limited beta (board only, now):** fix UX-1 (waitlist), UX-2 (honest copy), UX-9 (legal pages), SEC-1 (proxy hops); add CI; fix FR-A3 and FR-A6.
- **R1, closed beta, 2 campuses (6 weeks):** B1–B4, C1–C5, D1–D6, E1, F1, F2, G1, H1–H3; India supply FR-A5 ≥ 1,500.
- **R2, open beta (12 weeks):** B5, B6, C6, E2, E3, F3, F4, F5, G2, G3, N1–N7 (network as a Plus feature).
- **R3:** N8 campus alumni, campus dashboard (UC5), employer "Fresher Drop" (UC6), paid API/MCP (UC7).

## 10. Dependencies and open decisions
1. Auth provider (phone OTP vendor for India: MSG91 / Twilio / Firebase).
2. Which India ATS endpoints are public and allowed; verify each before ingest (CLAUDE.md legal guardrail).
3. Prefill support per ATS: verify Greenhouse, Lever and Ashby query-param prefill; otherwise use the copy panel.
4. Inbound email provider for reply threading (SES / Postmark).
5. Recap image rendering (satori/og on the server).
6. Pricing test: ₹49 vs ₹79 weekly.
7. Auth: phone OTP or Google (Gen-Z, India), or PLAN.md's email plus scrypt password. Recommendation: phone OTP plus Google, with email kept for replies.
