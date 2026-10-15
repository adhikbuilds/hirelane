# Shortlist teardown (recon 2026-10-15)

Source files: shortlist-text.md (visible text of /, /pricing, /how-it-works, /compare), shortlist-llms.txt,
shortlist-api-sample.json (real response of GET https://api.shortlistapp.co/public/jobs), shots/sl-*.png.

## Product
AI job-application agent ("Pip" mascot) + public job board (15k–27k roles read from company career pages, refreshed every 6h,
closed roles deleted). Agent: upload resume once → ranked matches with explained score ("9 of 11 requirements matched, salary
above your $80k floor, Kubernetes not on your resume") → one at a time Apply/Pass ("pass = gone forever") → Pip drafts answers
from the CV, shows the full form, flags "NEEDS YOU" questions it won't guess (visa, start date, salary) → Send, 4-second undo
→ replies arrive at a per-user Shortlist address, filed against the application, forwarded to the real inbox.
Autopilot (paid): a rule (min match score, my role only, N/day) → applies within minutes of posting, batch email with pause link.
ATS targets: Greenhouse, Ashby, Lever, Workable, Rippling. Never applies twice (idempotency). Handles email OTP mid-application.

## Pricing (India-first)
Free: 10 applications, no card. Weekly/Monthly/Quarterly: Basic ₹79/wk 30 apps, Pro ₹189/wk 75, Ultra ₹399/wk 175; UPI or card;
USD outside India. Volume is the only difference — Autopilot on all paid.

## Tech fingerprint
- Public read-only API api.shortlistapp.co/public/jobs with q, role, country, remote, salary, workplace, employment, level, visa,
  posted, page → {jobs, page, pageSize, pages, total}. Job fields: Key ("ashby:openai:<uuid>"), Slug, Title, Company, Location, URL,
  Remote, RoleFamily, SalaryMin/Max/Currency, Description, Countries, PostedAt, FirstSeenAt, Level, Workplace, Employment, Visa, Skills[].
  PascalCase JSON → likely a Go backend.
- llms.txt for agents; /job/{slug} serves `Accept: text/markdown`; sitemap.xml of every job; SEO pages ("LazyApply alternative",
  "Remote Backend Engineer Jobs" lists). Strong agent-/SEO-native distribution play — replicate.

## What it does well (replicate)
- The core loop UX: explained match score, one-card-at-a-time triage, human approval with full preview, "needs you" instead of
  hallucinating, 4s undo, reply threading. Honest comparison page. Tight copy. Agent-readable surfaces (llms.txt, markdown, public API).

## Gaps (where we add depth + better UI)
- UI reads as AI-template: orange-on-cream, emoji mascot, phone mockup, stats band, 3-card "old way" grid, testimonial row.
  User verdict: "looks like AI slop, but the gimmick is good". Keep the mechanics, redesign the look with a real point of view.
- Board quality: ~60% "Salary not stated", lowercase company slugs ("openai", "plaid"), letter-avatar logos, Description empty in
  list API, RoleFamily often empty, Countries null.
- No transparency on how matching works beyond a %; no tracker/kanban for applications; no resume versioning visible on the board;
  no company pages; no salary normalization across currencies/periods.

## Legal scope for our build
- Ingest jobs ONLY from public ATS board APIs: Greenhouse `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true`,
  Lever `api.lever.co/v0/postings/{company}?mode=json`, Ashby `api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true`.
  Do NOT scrape shortlistapp.co or LinkedIn.
- MVP stops at "handoff": draft + approve + open the employer form prefilled/with copyable answers. Real headless form submission
  (Playwright) is a later, flagged phase that requires explicit per-application approval and respects each ATS's terms.
