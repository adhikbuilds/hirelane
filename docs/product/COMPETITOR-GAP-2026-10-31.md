# Competitor feature-depth gap analysis (2026-10-31)

**Last updated:** 2026-10-31
**Question from the owner:** "Superset and other platforms have very good UI and features to a very good depth. We lack all of this."
**Inputs:** docs/recon/competitors-2026-10-31.md, docs/recon/superset-notes.md, CAMPUS-FIRST.md, CAMPUS-PRD.md, DECISIONS-2026-10-29-night.md, PLAN.md Amendments A and B, docs/design/website-dashboards-plan.md. Code read on 2026-10-31 (read-only), including the uncommitted overnight build.

**Rules for this document:**
- Every competitor capability below comes from public pages or search results. It is a **vendor claim, unverified** unless marked otherwise. No account was created.
- Competitor names appear only in the analysis. Product suggestions use our own words, flows and design. Nothing here proposes copying their copy, feature names, assets or layouts.
- No prices or statistics are invented. Our own price figures in CAMPUS-FIRST §9 stay tagged [assumption] and are not repeated here.

**Status labels used for Hirelane:**
- **Built:** code exists and is reachable for real data.
- **Built, not pilot-ready:** code exists (often the uncommitted overnight build), but a documented gap blocks real use. The gap is named.
- **API only:** a service and a `/api/v1` route exist, but no screen calls it.
- **Sample only:** a screen exists, but it renders sample data or is dev-only (`notFound()` in production).
- **Partial / Missing / Planned.**

**Note on sources:** the brief pointed to `docs/apply.md`. It does not exist, and neither do `docs/campus.md` or `docs/answers.md`, which docs/eligibility.md links to. Gap status below comes from docs/architecture.md §7 (open items 17–29), docs/eligibility.md, docs/design/campus-build-plan.md (Slice 3 is "STATUS RED"), and the header comments in the code.

---

## 1. Summary

1. The owner is right on **breadth**. Superset's placement-cell suite covers the whole on-campus cycle: drive-day scheduling, assessments, approval chains, an employer CRM with mail sync, internships and fairs. We have none of these, and per our positioning we should not build most of them.
2. We are also thin where it **does** matter for a pilot. The student core loop is not live: there is no picks or matching service, so a real student's Home deck is empty (`apps/web/app/(app)/home/page.tsx`). The TPO drive inbox, settings, roster import and offer review are API-only or dev-only screens. Mail goes only to a file outbox, so no real notification reaches anyone.
3. Supply is the biggest single gap. There are 129 boards on 3 ATS connectors (`packages/ingest/boards.json`), and CAMPUS-FIRST counts 75 India entry/intern roles. Superset's student pages claim a large verified monthly job volume [vendor, unverified], but complaints say postings are too infrequent [relayed].
4. **Where we are actually ahead, in code and not only on paper:**
   - **Eligibility depth.** There are 7 criterion types with per-level "throughout" rules (`packages/engine/src/eligibility/types.ts`). Every verdict shows its maths ("Your 12th: 58%. Needs 60%. Short by 2%"). "Unknown never blocks" is a design rule. CGPA conversion follows campus rule, then confirmed university rule, then unknown.
   - **Privacy.** k ≥ 10 suppression with complementary suppression sits in the database (`0011a`). Students choose their share level, and every TPO read lands in a log the student can see (`tpo_access_log`).
   - **Resume readability.** Image-only and garbled PDFs are detected, and the 9-check health report shows "N of 9 pass" with no fake score.
   - **Scam signals** on pasted notices: 7 signal types (`packages/engine/src/scam.ts`).
   - **Off-campus outcome to NAAC 5.2.1 export,** including TPO verification and a sealed offer letter.
   - **Apply pipeline.** A database-enforced state machine, receipts, and "nothing invented" answers backed by a CHECK constraint.
5. Superset's own users complain about exactly the things we are deepest in: wrong "not eligible" verdicts, missed notifications, an app that hangs, and reports that can't be customised [relayed, App Store/Play/Capterra]. That is our wedge, but only if our notifications actually land and our eligibility is visibly right.
6. **Recommendation:** for the pilot, do not chase breadth. Make the after-the-drive loop real and deep: supply, picks, eligibility, drive inbox, notifications, outcomes and NAAC. Import the cohort from the incumbent rather than rebuild its system of record.

---

## 2. Feature-depth matrix

Legend for competitor cells: **D** = deep (several sub-features named), **S** = shallow or presence only, **—** = not found on public pages, **?** = not stated publicly. All competitor cells are vendor claims or relayed reviews, unverified. Unstop and Naukri Campus notes come from search results only (Unstop's home page was behind a cookie wall). Handshake's public career-center page is shallow, so most of its cells are "?".

### 2.1 Placement cell

| Capability | Superset | Handshake | Unstop | Naukri Campus | Hirelane today (evidence) |
|---|---|---|---|---|---|
| Student system of record (marks, backlogs, programmes) | **D**: "system of record" for student data, eligibility, drives, offers | ? (SIS integration not on public page) | — (no TPO dashboard found) | — | **Not built, by design.** Cohort = passout year × programme. Roster stores email HMAC plus a placed flag only (`0011_campus.sql` `cohort_roster`). Marks live only in the student's own `eligibility_profiles` (RLS own) |
| Eligibility rule types | **D**: per-drive rules, e.g. CGPA plus no active backlogs | ? | S (employer-side screening) | — | **Built, deeper than the example shown.** `min_score` per level (10th, 12th, diploma, UG, PG, or "throughout"), `no_active_backlogs`, `max_backlog_history`, `passout_years`, `degrees`, `branches`, `max_gap_years` (`engine/src/eligibility/types.ts`). Parsed from free notice text, with evidence spans (`criteria.ts`) |
| Eligibility explanation to the student | ? (a % match naming skills on student recs; eligibility reasons not shown) | ? | ? | — | **Built in the engine, missing on screen.** Readable reasons with maths and gap (`docs/eligibility.md`, `eligibility.verdicts.test.ts`). The `/you/eligibility` page is **not built** (architecture §7 item 26) |
| CGPA → % conversion | ? | — | — | — | **Built, not pilot-ready.** Campus rule (`campuses.cgpa_rule`, bounded by `0013b`), then a confirmed university rule (`data/cgpa-rules.json`, 28 rows, **0 verified**), then unknown. **No service or screen lets a TPO set the campus rule** (no `cgpa_rule` writer in `packages/services`) |
| Eligibility auto-refresh when records change | **D**: lists refresh automatically, students notified | ? | ? | — | **Partial.** The student's own drive verdicts are live on each request (`services/campus/drives.ts` `listMyDrives`). TPO counts refresh nightly (`workers/runner/src/tasks/campus-stats.ts`). No "you became eligible" notification |
| College verification of marks | **D**: departments verify; "verified by college" badge | ? | Aadhaar check on the employer side | — | **Missing.** Membership is verified (college-email OTP or roster match). Marks are student-confirmed only. See owner decision 3 |
| Drive intake | S (JD posting inside the system) | ? | event microsites | — | **API only.** Paste a notice → criteria and scam flags parsed → published to one cohort (`publishDrive`, `POST /api/v1/tpo/drives`). The console page `/campus/drives` re-exports a **dev-only sample page** that 404s in production (`app/campus/drives/page.tsx` → `app/dev/campus/drives/page.tsx`) |
| Drive lifecycle (draft, scheduled, deadline, close) | **D** (cycle view, rounds) | ? | D (event dates, reminder emails) | — | **Partial.** Status is only `published` or `closed` (`drives_status` CHECK). There is no deadline column; the student adapter guesses the deadline from the notice text (`lib/adapters/drives.ts` `parseDeadline`). No draft and no schedule |
| Rounds, panels, rooms, slots; students book slots | **D**: drive-day control centre | ? | D for employers (virtual interviews) | — | **Missing; do not build** (§5) |
| Assessments (question banks, negative marking, proctoring) | **D** | ? | **D** (proctoring, Aadhaar) | **D** (a national aptitude test, practice tests) | **Missing; do not build** (§5) |
| Drive funnel (eligible → applied → test → interview → offer) | **D**: per-drive funnel counts | ? | D (campaign dashboard, employer side) | — | **Partial.** Per drive: eligible, unknown and ineligible counts, k-suppressed, with a differencing guard (`campus-stats.ts` `K_DRIVE`). Applied, interview and offer are **not linked to a drive**: `applications` needs a `job_id` with an ATS, and `outcomes` has no drive id |
| Cohort readiness analytics | S (readiness diagnostic, student side) | "engagement to outcomes" [vendor] | college-wise engagement (employer side) | — | **Built, ahead in kind.** 12 fixed cohort metrics: joined, resume stages, ATS-readable, 4 eligibility blockers, interviews and offers reported, placed on roster (`COHORT_METRICS`). k = 10 over verified members, rounded to 5 (`0011a`). Real-data screens at `/campus` and `/campus/students`. **Skill-gap aggregate missing** (PRD C3) |
| Reminders to eligible non-applicants | **D** | curated pushes | reminder emails | ? | **Missing.** `notifications.kind` allows only `employer_message` and `application_update` (`0012_apply_pipeline.sql`) |
| Approval chains for offers and bulk rollouts | **D** | ? | — | — | **Missing; do not build** (§5) |
| Live activity feed | **D** | ? | ? | — | **Missing.** Any feed must be k-safe; see P2 |
| Outcome capture and verification | S (offers inside drives) | outcome rates in case studies [vendor] | offers (employer side) | — | **API only.** Student reports an interview or offer and attaches a sealed letter. TPO lists, views the letter (logged) and verifies (`services/campus/outcomes.ts`, `/api/v1/tpo/outcomes/*`). `/campus/outcomes` reads real data, but `higherStudies` is hard-coded `0` (`app/campus/outcomes/page.tsx`). No "not accepted with a reason" path. No student outcome screen |
| NAAC / NIRF reporting | — (not stated) | — (US) | — | — | **Built, not pilot-ready.** 5.2.1-shaped CSV, formula-safe, every row access-logged (`services/campus/naac.ts`). Headers are marked **[unverified]** against the NAAC manual. Higher-studies rows are not captured |
| Custom reports, xlsx export | D in the CRM (season dashboard, xlsx) [vendor]; admins still ask for custom reports [relayed] | ? | ? | — | **Partial.** NAAC CSV only. No cohort report for management |
| Staff roles / RBAC | **D**: scoped per team, role and drive | ? | ? | — | **Partial.** Roles are `owner` and `staff`. Invite, remove and transfer ownership exist (`0013_campus_audit.sql`), API only. The plan's Head/Officer/Viewer is not built. **No `/campus/signin` page** |
| Import from the incumbent ERP | n/a | SIS [?] | — | — | **API only.** CSV → email HMAC plus placed flag; staged, applied nightly (`importRoster`, `campus_apply_roster`). Placed students get no drives (`listMyDrives`) |
| Internships (allotment, work logs, evaluations) | **D** | ? | D (internship hiring) | D (internship listings) | **Missing; do not build** (§5) |
| Virtual fairs, pool campus | **D** | **D** (fairs and events) | **D** (events, hackathons) | — | **Missing; do not build** (§5) |

### 2.2 Employer CRM (the placement cell's relationships with recruiters)

| Capability | Superset | Handshake | Unstop | Naukri Campus | Hirelane today |
|---|---|---|---|---|---|
| Company and contact records, owners, custom fields | **D** | ? | — | — | **Missing; do not build a CRM** (§5) |
| Season pipeline with auto-advancing stages | **D** | ? | — | — | Missing |
| Invitations and broadcasts with open/click tracking | **D** | ? | D (event reminder emails) | — | Missing |
| Mail sync (Gmail, Outlook), unified inbox | **D** | ? | — | — | Missing on the TPO side. On the student side, the apply address plus inbound parsing is **built, fixture-only** (`workers/runner/src/tasks/inbound-scan.ts`) |
| AI features (recommendations, drafts, reply intent) | **D** | ? | AI match (employer side) | — | Missing. Rules-only reply-kind detection exists for students (`inbound-classify.ts`: interview, test, rejection, other) |

### 2.3 Student

| Capability | Superset | Handshake | Unstop | Naukri Campus | Hirelane today |
|---|---|---|---|---|---|
| Resume upload formats | ? | ? | ? | builder [relayed] | **Built.** Text PDF and DOCX, ≤ 5 MB, magic bytes, zip guard, sandboxed child process (`workers/runner/src/resume/extract/`). Child network isolation is a deploy precondition that is still open (architecture §7 item 25) |
| ATS readability check | ? (template output only) | — | — | — | **Built, ahead.** Detects image-only and garbled text layers (`engine/src/resume/text-layer.ts`), with health issue #1 and two fixes |
| Resume health report | S ("resume intelligence") | — | — | — | **Built.** 9 fixed checks, each with a reason and a fix, "N of 9 pass", no score (`engine/src/resume/health.ts`) |
| Resume builder | **D**: templates, college format from verified records, PDF, share link | ? | ? | S (free builder) [relayed] | **Built.** Guided questions → one-page pdfkit PDF that round-trips through our own extractor (`resume-render.test.ts`). No share link, no college format |
| Layout-aware parsing (two-column, tables) | ? | ? | ? | ? | **Built, uncommitted.** `engine/src/resume/layout.ts`, `normalize.ts`, `workers/runner/src/resume/extract/layout.ts`. Accuracy on real resumes is unmeasured (PRD RP5) |
| Job recommendations with a match explanation | **D**: % match naming the skills, refreshed daily, "prepare first" for stretch roles | **D**: curated pushes | D (AI match) | ? | **Missing at runtime.** There is no picks service (HLD M3). A real student's deck is `[]` (`app/(app)/home/page.tsx`, comment line 12). Engine parts exist (`worthwhile.ts`, `requirements.ts`, `skills.ts`) |
| Supply breadth | partner employers [vendor]; complaints of infrequent postings [relayed] | employers post free | 800+ brands [vendor, unverified] | fresher jobs and drives | **Thin.** 129 boards on Greenhouse, Lever and Ashby (`packages/ingest/boards.json`, `src/connectors/`). CAMPUS-FIRST [db]: 75 India entry/intern roles. S2 connectors await terms notes |
| Eligibility checked on open-market roles | — | — | — | — | **Engine built; no runtime caller for jobs** (no picks). Drives only |
| Paste or share an outside job | — | — | — | — | **Engine only.** `parsePastedJob`, `scoreForProfile` (`engine/src/jobtext.ts`) have no caller outside the engine (architecture §7 item 27). `/paste` is a dev sample. No PWA `share_target` (no web manifest in `apps/web/app`) |
| Scam check | "fraud detection" (TPO side) [vendor] | — | — | — | **Built in the engine and on drives.** 7 signals: upfront fee, offer-letter fee, chat-only contact, free-mail sender, urgency, unrealistic pay, shortened link (`engine/src/scam.ts`). Applied on drive publish. Not on pasted jobs yet |
| Application status | **D** (registered, OA, interview, accepted) | ? | D | ? | **Built, fixture-only.** Status machine ready → submitting → submitted / blocked_fallback / failed / undone, enforced by a DB trigger (`0012`). Tracker reads real rows (`app/(app)/tracker/page.tsx`) |
| Applying for the student | — | — | — | — | **Built, fixture-only.** Consent `auto_apply`, a 4 s undo, a daily cap, a per-ATS kill switch, receipts, "needs you" fallback, CAPTCHA or login → finish on their site (`packages/agent/src/submit/`, `apply-submit.ts`). The transport refuses every non-`.fixture.invalid` host (`submit/transport.ts`). `HIRELANE_AUTO_APPLY=live` still behaves as fixture (`apply-mode.ts`) |
| Reply tracking | — | — | — | — | **Built, fixture-only.** Per-student apply address, inbound parse from a local `.eml` folder, classification, sealed excerpt, in-app notification, forward through the file outbox (`inbound-scan.ts`). No real MX yet |
| Notification channels | **D** claimed (test slots, interviews, status); **missed and crashing** per reviews [relayed] | **D** (phone pushes) | email reminders | ? | **Partial.** In-app table only (`notifications`). Mail is the file outbox only (architecture §7 item 20). No push, no WhatsApp |
| Mobile app | **D** (Android and iOS); reviews report hangs and crashes [relayed] | **D** | ? | ? | **Planned.** Server-rendered web. `/api/v1` is ready for a future app, but Bearer auth is not built (`docs/public-api.md` §14.5). `pnpm budget` is RED (§7 item 22) |
| Practice: mock interviews, English score, aptitude | **D** | ? | D (competitions) | **D** (national aptitude test, practice) | **Missing; do not build** (§5) |
| Placement stories from past batches | **D** (moderated) | ? | ? | ? | Missing. See P2 (k-safe outcome stories) |
| Privacy controls the student can see | ? | ? | ? | ? | **Built, ahead.** Share level aggregate/outcomes/full (`cohort_members.share_level`), the TPO access log visible to the student (`/api/v1/campus/access-log`), a 24 h purge, full export (`/api/v1/me/export`), 18+ gate |
| Sign-in | ? | SSO [?] | ? | ? | **Built.** Google OIDC, 6-digit email code, LinkedIn OIDC (not live-verified, §7 item 28). Phone OTP waits on a vendor decision |

### 2.4 Employer side

| Capability | Superset | Handshake | Unstop | Naukri Campus | Hirelane today |
|---|---|---|---|---|---|
| Employers post roles | **D** | **D** (free posting) | **D** (year-round campaigns) | ? | **Missing.** S4 (roles via the college's recruiter network) is after the pilot |
| Screening, assessments, AI interviews | **D** | ? | **D** (incl. 360° proctoring) | **D** (aptitude test as a screen) | **Missing; do not build** (§5) |
| Campaign analytics (diversity, college-wise) | ? | ? | **D** | ? | Missing |
| ATS/HRIS integration | "custom integrations" [vendor] | ? | **D** [vendor] | ? | Read-only ingest from public Greenhouse, Lever and Ashby boards. Fixture-only form readers for the same three |

### 2.5 Trust and platform

| Capability | Superset | Handshake | Unstop | Naukri Campus | Hirelane today |
|---|---|---|---|---|---|
| Certifications (SOC 2, ISO 27001) | claimed [vendor, unverified] | ? | ? | ? | **Missing.** Not a pilot need. Owner decision on timing |
| SSO, MFA for staff | claimed | ? | ? | ? | **Partial.** Google or email code for staff. No MFA, no SAML |
| Row-level isolation and k-anonymity | ? | ? | ? | ? | **Built, ahead.** RLS ENABLE on every user table, SECURITY DEFINER read functions, `verify-rls` modes, k = 10 with complementary suppression and drive-differencing guards |
| Public, documented API | "custom integrations" | ? | ? | ? | **Built.** `/api/v1` with OpenAPI, Idempotency-Key, problem+json, cross-user = 404 (`docs/public-api.md` §14). Plus `/api/v1/tpo/*` and `/api/v1/campus/*` (uncommitted) |
| DPDP posture (18+, purge, grievance officer) | ? | n/a | ? | ? | **Built, not pilot-ready.** 18+ attestation and 24 h purge exist. **No grievance officer named, so production accounts stay off** (PRD A5) |
| Affordability for tier-2/3 | "talk to sales", described as out of reach for tier-2/3 [relayed] | n/a | free listing for colleges | free for students | Not priced. CAMPUS-FIRST §9 is [assumption] |
| Visual polish | high, by the owner's judgement | high | ? | ? | **Behind.** The owner rates site feel 1/10. A design plan is written and awaiting review (`docs/design/website-dashboards-plan.md`) |

---

## 3. Where competitors are weak, and how Hirelane exploits each

| Weakness (source) | Why it happens, as far as we can tell | How Hirelane exploits it | Proof we would show a TPO |
|---|---|---|---|
| **Wrong eligibility.** "Not eligible" when the JD matches; "your college is not eligible" on most jobs [relayed, App Store/Play reviews] | Binary verdicts with no shown reason, and supply gated by partner lists | Three-state verdicts with **unknown never blocking**. Every line shows the maths and the missing input. CGPA conversion is never guessed. Add a student-facing "this looks wrong" report per verdict (P0-4) | Pass-to-fail error count gated in `engine:eval` (today only accuracy and unknown-to-fail are gated, docs/eligibility.md §7). A per-drive "reached: eligible + couldn't check" line |
| **Missed notifications; tapping one crashes the app** [relayed] | A native app with a fragile push path | Phone-first web with **two channels for anything that matters**: in-app plus email, plus web push or WhatsApp after the owner's vendor decision. Every notification is also a row on Home, so a missed push loses nothing (P0-5) | Delivery receipts per channel in ops. A "drive closes tomorrow" item on Home the day before |
| **App hangs; PDF viewer has no back button; profile edits stuck with no support** [relayed] | Heavy app, many modules | Server-rendered pages, no client PDF libraries, every page usable at 390 px. A support path inside the product (P1) | Captures at 320–430 px. A first-load JS budget (owner must reset the RED limit) |
| **Partner-only supply; infrequent postings** [vendor framing; relayed complaints] | Jobs unlocked through a partner list | Open-market roles from employer career pages (S1, S2), drives the TPO pastes (C4), and any job a student pastes or shares (S5, S5a). Honest weekly counts, never padded (S4) | G0 per programme × city, shown to the TPO as "roles your students qualified for this week" |
| **No NAAC/NIRF outcome reporting** (not stated on its pages) | The suite tracks on-campus drives, not off-campus outcomes | Student-reported, TPO-verified off-campus offers with a sealed letter, exported in the 5.2.1 shape. Add higher-studies capture so the full 5.2.1 figure is computable (P0-6) | A sample export reviewed against the current NAAC manual before any college files with it |
| **Cost for tier-2/3** ("talk to sales"; out of reach per a third-party blog) [relayed] | Enterprise suite pricing | Sell a narrow layer (cohort readiness, drive inbox, outcomes) that needs no ERP migration. Free for students | Owner decision on price shape. No public prices until then |
| **Admins can't customise reports; hard to track many students at once** [relayed, Capterra] | Fixed dashboards | Fixed but **explained** aggregates (base line, formula, k note), a breakdown toggle (programme, blocker, drive), and a one-click management report (P1-3). We deliberately do not offer per-student marks tables | A report that a principal can read without training |
| **Photo face-check blocks profiles for weeks** [relayed] | Identity checks on profile photos | We collect no photo and no ID. Membership is proved by college-email OTP or roster match | Nothing to show; this is an absence |

---

## 4. Prioritised build list for a supervised pilot

**Pilot shape:** one large private university (segment A, already on an incumbent ERP) plus tier-3 colleges (segment B), supervised by us, one semester. Positioning holds: we are the **after-the-drive layer**, and we import from the incumbent rather than replace it.

**Gates that are not features but block every P0 item from touching real students:** a named grievance officer (PRD A5), a real transactional mail transport and sending domain (architecture §7 item 20), child network isolation for resume extraction (item 25), the `pnpm budget` limit reset (item 22), and a security review plus commit of the overnight build. These are listed as P0-0.

Effort: **S** ≤ 3 days, **M** 1–2 weeks, **L** > 2 weeks, for one builder with review.

### P0: without these the pilot cannot run

| # | Item | User problem | Depth target (what "good" looks like) | Effort | Depends on |
|---|---|---|---|---|---|
| P0-0 | **Pilot gates** | Real students cannot sign up; mail never leaves the box | Grievance officer named and shown on `/security`. Transactional provider behind `Mailer` with SPF, DKIM and DMARC on a sending subdomain. Apply domain MX live. Extraction child has no network. Overnight build reviewed (security-reviewer go) and committed | M | Owner decisions 1, 2, 7 |
| P0-1 | **Supply for Indian freshers** | "There's nothing here for me." With 75 India entry roles, the loop is empty | ≥ 10 worthwhile roles per week per programme × city for the pilot's top 3 programmes (G0). S1 board discovery to ≥ 1,000 companies. At least 2 S2 connectors (the ones mass recruiters use) after dated terms notes. Remote-for-India filter (S7). Weekly G0 report per route | L | Owner sign-off per connector terms note |
| P0-2 | **Picks: matching service and live Home deck** | A real student's deck is empty | Daily picks from open roles, filtered by eligibility (fail hidden, unknown shown with reason), placed students excluded, honest counts ("2 new roles you qualify for this week"). Each pick shows rules with maths, matched and missing skills, and source and freshness. Refreshed after each ingest. No % ring | L | P0-1; HLD M3 |
| P0-3 | **Paste or share an outside job** | Tier-3 students get jobs as WhatsApp forwards and can't tell if they qualify or if it's a scam | `/paste` live on the engine: parse, eligibility with maths, scam signals, "add to tracker, apply at source". Web manifest with `share_target`, so "Share → Hirelane" works on Android. Link never fetched. Works on a 4G low-end phone | S–M | Engine built (`jobtext.ts`, `scam.ts`) |
| P0-4 | **Eligibility you can trust** | Wrong "not eligible" is the top incumbent complaint. Our verdicts are invisible: there's no screen, and no TPO can set the CGPA rule | `/you/eligibility` page (view, edit, confirm, see every rule that used a conversion). TPO setting for the campus CGPA rule with source and date. Fetch-verify university rows for the pilot universities (today 0 of 28 verified). Gate pass-to-fail in `engine:eval`. A "this verdict looks wrong" button that logs the criterion id, not the value | M | Owner: which universities first |
| P0-5 | **Drive inbox, live in the console** | The TPO forwards drives on WhatsApp today; ours exists only as an API | Console pages A-4 and A-5 on real data: paste → parsed form with "check" marks → reach panel ("eligible + couldn't check") → publish. Add `deadline` and `status` draft/closed columns, a rounds text field and a documents field (free text, no scheduling). Students see eligible and unknown drives with reasons, sorted by deadline. **Scam flags shown to staff, not students** (the plan says so; `listMyDrives` returns them today) | M | P0-4 (CGPA rule); a migration |
| P0-6 | **Notifications that land** | Missed updates are the incumbent's most visible failure | New kinds: `drive_published` (eligible or unknown only), `drive_closing` (day before), `employer_reply`, `outcome_verified`. Each is a Home row plus email. Web push on the PWA, or WhatsApp after the vendor decision. Quiet hours. Unsubscribe on non-critical kinds. Delivery and open counts in ops, never content | M | P0-0 mail; owner decision 5 |
| P0-7 | **Outcomes and NAAC, end to end** | The TPO's paid-for reason: off-campus offers for 5.2.1 without Google Forms | Student outcome screen ("I got an interview / offer / higher-studies admission", letter upload). Console A-6 and A-7: verify, "can't verify" with a reason the student sees, letter viewer logged. Add a `higher_studies` outcome kind so the 5.2.1 figure has its full numerator. Headers checked against the current NAAC manual by a person, with the date | M | Migration; G4 conversations for column shape |
| P0-8 | **Import from the incumbent, with a screen** | Segment A already has an ERP; the cohort must come from it, not be re-entered | Console A-8: upload CSV, map columns (college email, placed), preview counts and errors, import. Copy says what is kept (hash and flag) and that the file is deleted. Re-import is idempotent; the next nightly run drops placed students from picks and drives | S | Service built (`importRoster`) |
| P0-9 | **Console sign-in, roles and privacy fixes** | Staff can't sign in to a real console; the approved overview leaks small counts | `/campus/signin` (invite-only). Roles Head / Officer / Viewer mapped onto `tpo_members.role`. Fix the leaks in plan §0.5 (hidden count hides its share; complementary merge; weekly buckets). Cohort switcher and base line on every page | M | Plan Part 4 approved |

### P1: makes the pilot convincing

| # | Item | User problem | Depth target | Effort | Depends on |
|---|---|---|---|---|---|
| P1-1 | **Supervised live apply on supported ATS** | Students want "swipe = applied" (owner decision 1) | Live transport for Greenhouse, Lever and Ashby, behind the flag, for named pilot students only. Per-platform kill switch, daily cap, receipts, CAPTCHA/login → finish on their site. A supervised run log reviewed daily. Most tier-3 roles are not on these three ATSes, so set expectations | M | P0-0 apply domain; owner go for the live run; legal review in auto-submit plan |
| P1-2 | **Drive funnel past "eligible"** | The TPO wants to know who applied, got tested, got interviewed, per drive | Student marks "I applied to this drive" and later outcomes, linked by `drive_id`. Per-drive funnel eligible → applied → interview → offer, each k-gated, released only with the drive-differencing guard | M | P0-5, P0-7 |
| P1-3 | **Management report** | Admins ask for reports they can hand up | One-click PDF/xlsx per cohort and date range: totals, blockers, resume health, outcomes, each with base and formula. Same k rules as the console, applied in the export too | S–M | P0-9 |
| P1-4 | **Skill-gap aggregate** | "What should we train them on?" (also feeds prep partners) | Top missing must-have skills across roles students were eligible for, per programme, k-gated | S | P0-2 |
| P1-5 | **Real inbound mail** | Replies to the apply address must reach the student | MX for the apply domain, Authentication-Results check (already coded), forward within 60 s p95, kind detection on real mail with a labelled eval set | M | P0-0 |
| P1-6 | **Phone OTP and a support path** | Shared phones, Gmail never opened; "stuck, no reply" complaints | Phone OTP sign-in after the vendor decision. An in-product "something's wrong" form with a ticket id and a reply SLA the owner sets | M | Owner decision 5 |
| P1-7 | **Resume accuracy on real resumes** | Parsing errors feed wrong eligibility | RP5: 200 consenting, de-identified pilot resumes. Field accuracy ≥ 90% gated in CI. RP6 weekly top-10 error report | M | Pilot consent flow |
| P1-8 | **Verified-marks badge, thin version** (see §5 note) | Recruiters and TPOs trust college-verified marks more | **Flagged ERP risk.** Thin version only: the roster CSV may carry a per-student "marks match college record: yes/no" flag that the college computes, never the marks. The student sees "your college confirmed your marks". Recommend only if G4 says TPOs will fill it | S | Owner decision 3 |

### P2: after the pilot proves the loop

| # | Item | Notes | Effort |
|---|---|---|---|
| P2-1 | Android app on `/api/v1` with Bearer sessions | Only after the web pages hold on low-end phones. Push becomes native | L |
| P2-2 | Local OCR for image-only PDFs | Separate owner decision; bundled language data, worker only | M |
| P2-3 | Roles from the college's recruiter network (S4) | A small posting form for employers with no ATS, approved by the TPO. **Flagged CRM risk:** no contact database, no pipeline, no broadcasts | M |
| P2-4 | k-safe outcome stories | "Students from your programme got interviews at these kinds of employers this term", generated from verified outcomes with k ≥ 10, no names | S |
| P2-5 | k-safe activity digest for the TPO | Weekly "what changed" email (new joins, new verified offers, top blockers), no per-student events | S |
| P2-6 | Hinglish guidance copy | Resume output stays English | M |
| P2-7 | Staff MFA, then SAML SSO for segment-A universities | Ask at G4 whether it is a purchase blocker | M |

### ERP flags (explicit)

These items would pull Hirelane into building a placement ERP. Each has a recommendation.

| Item | Pulls us into | Recommendation |
|---|---|---|
| Storing per-student marks for the TPO, or a TPO-editable student table | The incumbent's system of record | **Against.** Keep marks student-owned. Thin alternative: P1-8 flag only |
| Drive rounds with dates, rooms, panels and slot booking | Drive-day operations | **Against.** P0-5 keeps rounds as free text shown to students |
| Assessments or proctoring | A test platform | **Against.** Partner with prep vendors the college already buys from |
| Offer approval chains | ERP workflow | **Against.** TPO verify / can't-verify is enough for outcomes |
| Employer CRM (contacts, pipeline, broadcasts, mail sync) | A sales CRM | **Against.** P2-3 is the thin version: an employer form, no CRM |
| Internship allotment, work logs, evaluations | Academic administration | **Against** |
| Per-drive funnel tied to on-campus drives the ERP runs | Duplicating ERP tracking | **Thin only.** P1-2 tracks drives pasted into Hirelane, not the ERP's drives |
| College-format resume generated from college records | The ERP's verified data | **Against for now.** Our builder makes one ATS-safe layout. Revisit only if a pilot college asks |

---

## 5. Things we should deliberately not build

1. **A placement ERP or student system of record.** It is the incumbent's switching-cost moat, the segment-A buyer already has one, and owning marks contradicts our privacy model (marks are student-owned, TPO sees aggregates). Import from it instead (P0-8).
2. **Assessments, aptitude tests, proctoring, Aadhaar checks.** Two incumbents (one claiming a national test) already compete here. It needs content teams and identity data we refuse to hold. Prep vendors are partners (CAMPUS-FIRST §4).
3. **AI mock interviews and English scoring.** These are the content-heavy, LLM-costly practice features. The owner ruled out LLM cost on resumes (PRD RP7), and the same logic applies. They don't move the campus north star (interviews within 60 days) as directly as supply and eligibility do.
4. **Drive-day control centre and slot booking.** On-campus operations, run inside the ERP.
5. **An employer CRM with broadcasts and mail sync.** A separate product with deliverability and anti-spam liabilities. Our mail domain is for students' replies.
6. **Virtual fairs and pool-campus events.** Event products need employer supply we don't have.
7. **Face checks, profile photos, ID numbers.** A source of incumbent complaints and a DPDP risk. Masking of typed ID numbers stays as a silent safety net only (PRD R4).
8. **Per-student TPO views of marks, resumes or answers.** This breaks the share-level promise and is the reason students will trust a college-paid product.
9. **Streaks, scarcity counters, "N others applied", score rings.** Rejected patterns (plan §0.2) and against the honesty rule.
10. **Scraping job boards or the incumbent's portal.** Their terms forbid it, plus IT Act s.43 risk (PRD S9). Supply comes from employer career pages, licensed feeds, the TPO's pasted drives and the student's own pastes.
11. **A native app before the web loop works.** The incumbent's app is a complaint source. One fast web app plus `/api/v1` keeps the Android option open.

---

## 6. Open owner decisions

1. **Pilot targets.** Which segment-A university and which tier-3 colleges, and who makes first contact. Drives the CGPA rule rows to verify first (P0-4) and the programmes for G0 (P0-1).
2. **Grievance officer and mail provider** (P0-0). Both block real accounts and every notification.
3. **College-verified marks.** Accept the thin "marks match college record" flag (P1-8), or stay purely student-confirmed? Recommended: ask at G4 before building.
4. **S2 connectors.** Which two connectors get their terms notes first (P0-1).
5. **Notification channel beyond in-app and email.** Web push on the PWA, WhatsApp through a vendor, or both, and phone OTP vendor and timing (P0-6, P1-6).
6. **Live apply in the pilot.** Approve a supervised live run for named students on the three supported ATSes, or keep fixture-only through the pilot (P1-1). Note that public copy must stay on the "today (pre-pilot)" version until then (plan §0.1).
7. **First-load JS budget.** The 100 KB rule cannot pass with the framework alone (architecture §7 item 22). Pick a delta-over-framework or a higher absolute cap.
8. **Higher-studies outcomes.** Add the outcome kind now so the 5.2.1 figure is complete (P0-7)?
9. **Scam flags on placement-cell drives.** The plan says staff only, but the service returns them to students. Confirm staff-only.
10. **Certifications (SOC 2 / ISO 27001).** The incumbent claims both [vendor, unverified]. Ask at G4 whether segment-A procurement requires them before a paid contract.
11. **Design plan approval.** Part 4 (console) and Part 3 (student app) gate P0-5, P0-7, P0-8 and P0-9 screens. The owner's 1/10 verdict on visual feel is a separate track from this depth list.
