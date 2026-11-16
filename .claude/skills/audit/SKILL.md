---
name: audit
description: Full product, design, engineering and security audit of Hirelane run as an ECC-only workflow. Produces docs/audit/AUDIT-<date>.md with P0–P3 findings, a scorecard, a 6-week plan and a beta verdict. Use when asked to audit, benchmark or assess beta readiness of Hirelane.
---

Use today's date (YYYY-MM-DD) wherever the report filename appears below.

Use a workflow. Run a full product, design, engineering and security audit of Hirelane, then write the report described below. Use ECC agents only (code-explorer, architect, security-reviewer, planner, tdd-guide, doc-updater). Do not use general-purpose, Explore or Plan agents. Keep it under 10 agents.

## 0. Gate: confirm the target
- The repo is ~/hirelane (pnpm monorepo: apps/, packages/, workers/, design-system/, e2e/, docs/, PLAN.md, CLAUDE.md). Run everything from there, not from any other repo.
- Before reviewing, confirm that the repo is Hirelane and that apps/web exists. If either is wrong or missing, stop and say exactly what is missing. Do not review whatever repo you happen to be in.
- Read CLAUDE.md, PLAN.md and docs/ first. Record which phase the project claims to be in, and keep that phase in mind when you judge what "missing" means.
- docs/mocks/ (the genz-a-* concepts; app-refined.html is rejected, so ignore it) are design concepts, not shipped UI. Audit what is actually built in apps/web/ separately, and report mock-vs-built gaps as their own list.

## 1. Orientation (one code-explorer agent, runs first)
Map the real system from the code, not from the docs:
- Apps, packages and workers, plus their dependency graph (see .dependency-cruiser.cjs)
- Every user-facing route and screen in apps/web, and every API route or server action
- Database schema, migrations, RLS policies, seed data
- The ingest, engine, enrich and runner pipelines
- Auth flow from start to finish
- Test inventory: unit (vitest), e2e (Playwright + axe) and eval scripts, including which ones actually run
- The guard scripts (brand-guard, no-submit-guard, verify-schema)
Flag every npm script that only echoes "not implemented" (for example db:verify-rls, db:verify-auth, agent:eval). Those are not verification.
Output: a structured map that every later agent receives as input.

## 2. Product and UX review (runs in parallel with 3 and 4)
- Core journey for a Gen-Z job seeker: land → understand the value in 5 seconds → onboard → discover jobs/companies → evaluate a job → save/act → come back. For every step, name the screen and file, then judge friction, clarity and drop-off risk.
- Compare what is built in apps/web/ against the approved concepts in docs/mocks/ (the "Wrapped" style rounds; Home, Discover, Company, Job, You). Mocks only set intent. List screens that are missing, stubbed or off-spec in the built app.
- Copy and tone: does it sound like Gen-Z without being cringe? Look at empty, loading and error states, and at trust signals (why should I believe this job or company data?).
- Retention hooks, notifications, personalisation, and what brings a user back on day 2 and day 7.

## 3. Frontend review (runs in parallel)
- Design-system usage: tokens versus hard-coded values, duplicated components, drift between design-system/ and apps/web
- Mobile at 360–430px: layout, tap targets, scroll, safe areas, gestures
- Accessibility against WCAG 2.2 AA: semantics, focus order, contrast, motion (prefers-reduced-motion), screen-reader labels. Run the existing axe e2e if it works and report the real output.
- Performance: bundle size, images, fonts, client/server boundaries, waterfalls, Core Web Vitals risks. Measure where you can, and label anything you estimate.
- Maintainability: state management, data fetching, type safety, dead code, test coverage of UI logic

## 4. Backend and security review (security-reviewer agent, runs in parallel)
- Review authentication, authorization, session handling, secrets, database design, tenant/user isolation (including RLS), input validation, rate limiting, error handling, logging, monitoring, API contracts, background jobs and workers, file uploads, notifications, and deployment readiness (docker/, docker-compose.yml).
- Pay special attention to OWASP risks: XSS, CSRF, insecure local storage/session handling, broken access control, IDOR, insecure redirects, injection (SQL and prompt injection in the engine/enrich LLM paths), SSRF in ingest/scraping, sensitive-data exposure, and missing rate limits.
- Keep verified code behaviour clearly separate from claims that are only documented and untested. Tag every claim [VERIFIED: file:line], [DOCUMENTED-ONLY] or [NOT FOUND].

## 5. Verification pass
- For each P0 and P1 finding, have a separate agent try to disprove it by re-reading the cited code. Every P0/P1 needs reproduction steps and at least one [VERIFIED file:line] citation. Downgrade anything that lacks them or that the verifier disproves. Mark the survivors CONFIRMED or PLAUSIBLE.
- Where the toolchain works, run `pnpm verify` and `pnpm e2e`, and quote the actual pass/fail output. If they can't run (for example, no DB), say so. Don't guess results.
- Classify every failed check as either a product defect or environment/fixture drift (missing DB, stale fixtures or snapshots, missing env, wrong Node version). Never count one as the other.
- Use only local, offline data: no live credentials, no live ATS/job-board requests (do not run ingest:run or ingest:record against real sources), and no external user data.

## 6. Benchmark scorecard
Score each area 1–10, give 2–3 lines of evidence with file references, and say what it would take to reach 8:
Product clarity · Gen-Z appeal · Trust and safety · Mobile usability · Accessibility · Design consistency · Performance · Frontend maintainability · Backend reliability · Security readiness · Test/release confidence

## 7. Deliverable
Write `~/hirelane/docs/audit/AUDIT-<YYYY-MM-DD>.md` containing:
- Executive summary: the strongest aspects and the biggest risks.
- Findings ranked P0 / P1 / P2 / P3. Each finding has: ID, title, evidence (file + line), verdict (CONFIRMED/PLAUSIBLE), user/business impact, recommendation, and effort (S/M/L or days).
- The scorecard from section 6.
- A proposed 6-week workflow in weekly milestones:
  - Week 1: stabilization and security
  - Week 2: core user journey and onboarding
  - Week 3: mobile and accessibility
  - Week 4: design-system consolidation and performance
  - Week 5: trust, matching, retention, and analytics
  - Week 6: QA, release readiness, and beta instrumentation
  For each week give the engineering tasks (mapped to finding IDs), design tasks, acceptance criteria, and measurable success metrics (e.g. "onboarding completion ≥ 70%", "0 axe serious/critical", "LCP < 2.5s on mid-tier Android").
- The top 10 changes that would most improve Hirelane for a Gen-Z audience, ranked by impact relative to effort.
- End with a ranked beta verdict: **ship**, **limited beta**, or **do not beta**. Pick one, give the reasons, and list the exact items that would move it up a level.

## Rules
- Be candid and specific. No generic advice: every recommendation points at a concrete file, screen or flow.
- No application-code, config or data changes. Writing docs/audit/AUDIT-<YYYY-MM-DD>.md is allowed, and it is the only file you write.
- Do not assume a feature exists. Verify it in the code, because docs, PLAN.md and mocks are not evidence of implementation.
- A stub script, a TODO or an "until Phase N" note counts as missing, not done.
- If the repository is not Hirelane or lacks the relevant app, stop and state clearly what is missing before reviewing anything.
- When the report is written, summarise the P0s and the beta verdict in chat and give the report path.
