# Owner decisions, night of 2026-10-29, and the overnight plan

## Decisions (owner, in chat)
1. **Right swipe = applied.** Hirelane submits the application on the company's own page with automation. When a site blocks it, ignore that one and fall back to "finish on their site". This supersedes the "student presses submit" rule and moves docs/design/auto-submit-opt-in.md from "not approved" to **approved direction**. Conditions the main session keeps (agreed in chat):
   - **One-time consent at onboarding:** "When you swipe right, Hirelane submits your application for you, using your Hirelane apply address." Recorded as consent kind `auto_apply`. A student can switch to "I'll submit myself" at any time.
   - **No bypassing CAPTCHAs, bot checks or logins.** A blocked submission becomes "finish on their site" with the answers ready.
   - **Nothing invented.** "Needs you" questions are answered once, during onboarding or at swipe time, from an answer bank. An answer without evidence blocks auto-submit for that role.
   - **Receipts.** Store what was sent: an answers hash, the resume version, the time and the result code.
   - **Per-platform kill switch**, and a daily cap per student.
   - **Build and test only against recorded fixtures.** No live submissions to real companies until the owner runs a supervised pilot.
2. **Apply with a Hirelane-owned address per student** (e.g. `rahul.k3x@apply.<our domain>`). Replies come to us and are tracked.
   - Receiving needs no warming.
   - Every employer message is forwarded to the student right away: an in-app notification first, email forwarding once our sending domain is warmed.
   - The address keeps working permanently. Students see which address was used.
   - This is the existing `reply_handle` / `inbound_messages` design (PLAN.md), now the default.
3. **Plan the dashboards before building more screens.** The owner rates the overall site feel 1/10 against funded-startup sites. Next step: a design plan for the website, the student dashboard and the admin dashboard (IA, page list, wireframes, component system, visual references). It is reviewed before any more UI is built.
4. **Tsenta-grade tracking.** When a feature is blocked (reply tracking, inbox parsing, status detection), research how Tsenta and similar products do it from public sources, then plan and build our own. Never copy their code or data.
5. **Approved UI so far:**
   - onboarding / sign-in
   - the dark analytics console
   - student app direction A (calm chrome, colour only on role cards)

   **Not approved:** the current landing page's overall feel.

## Overnight plan (ECC workflows, Opus review per batch, commit locally, no push)
Order matters because they share the dev database and packages:
1. **Finish slice 3:** the running workflow `hirelane-slice-3-flows`. Commit its work after `pnpm verify` passes.
2. **Engine hardening** (packages/engine, workers/runner):
   - CGPA university rule table (sourced) plus CGPA, SGPA and marks validation (PRD E5)
   - per-level verdicts for "throughout" rules, with student-friendly reason strings and the maths shown (E6)
   - parser RP1–RP3: layout-aware PDF, reference lists, normalisers
   - builder output passing our own checks
3. **Campus back end** (migration 0011):
   - campuses, cohorts, members, share levels
   - join by code or college email
   - drives with the parse → eligible-count → publish service
   - outcomes with letters, NAAC export, roster import
   - SECURITY DEFINER aggregates with k ≥ 10
   - console sign-in for staff
4. **Apply pipeline** (migration 0012, after 3):
   - applications state machine and tracker
   - per-student apply address with inbound parsing (fixture mailbox), plus forwarding through the file outbox
   - FormSpec readers for Greenhouse, Lever and Ashby forms (fixtures)
   - the auto-apply executor behind a flag, fixture-only, with receipts, kill switch, caps, fallback and consent
5. **Design plan** (planner + architect, read-only), written to docs/design/website-dashboards-plan.md for the owner's morning review.

Each batch: tdd-guide builds; security-reviewer and architect (Opus) give a go / no-go; tdd-guide integrates; `pnpm verify` must pass.
