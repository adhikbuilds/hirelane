# Hirelane: working rules for Claude Code

Hirelane is an original product built by adhikbuilds. Shortlist is the reference we studied (docs/recon/), not something we copy:
never use their name, logo, copy, mascot or data in the product.

## Source of truth
- `PLAN.md`: the phased build plan. Execute phases in order; tick the acceptance checklist in PLAN.md as each item passes.
- `docs/recon/*-notes.md`: teardown of Shortlist: what to replicate, what to beat, legal scope. Re-read before UI or data work.
- `docs/recon/shots/`: their screens (reference only, gitignored).

## Agents: ECC only
Never use general-purpose, Explore or Plan agents, and do not use the Workflow tool (its agents default to general-purpose).
- `planner`: break a phase into tasks before starting it (read-only)
- `architect`: schema, package-boundary and data-flow decisions (read-only)
- `code-explorer`: trace existing code before changing it (read-only)
- `tdd-guide`: writes tests first, then the code; the main builder for engine/ingest/agent packages
- `security-reviewer`: mandatory on every phase that touches auth, user input, PII, uploads, webhooks or API routes, and before every push
- `doc-updater`: README, docs/CODEMAPS at the end of each phase
Run independent agents in parallel. ECC agents have no web access: verify any vendor/API claim yourself (WebFetch) before relying on it.
Load the `frontend-design` skill before any UI work, and `claude-api` before any LLM code
(default model `claude-opus-5-5` for every call, overridable by env; the app must still work with no API key).

## Phase loop
1. `planner` → task list for the phase. 2. Build (tdd-guide for logic, you for UI wiring). 3. `pnpm verify` green
(tests + typecheck + lint). 4. Run the app and screenshot to `docs/screens/phase-N.png` (headless Chrome:
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1440,2400 --screenshot=<path> <url>`),
plus a 390px-wide mobile shot. 5. `security-reviewer` when applicable. 6. `doc-updater`. 7. Commit (conventional commits) and
`git push`. Then continue to the next phase without waiting, unless blocked on a decision only the user can make.

## Environment
- Web dev server: http://localhost:3001. Postgres (docker compose): host port 5433. The sibling project uses the other ports;
  don't change these.
- pnpm workspace, Node 24, TypeScript strict, Next.js 15 App Router, React 19, Tailwind v4, Drizzle, vitest, Playwright.
- Secrets live in `.env.local` (gitignored); keep `.env.example` current. Never commit keys or real resumes/PII.
- GitHub: `origin` = github.com/adhikbuilds/hirelane (private). The active gh account on this machine is a work account, so never run
  `gh auth switch`; scope commands with `GH_TOKEN=$(gh auth token -u adhikbuilds) gh ...`. Commits use the repo-local
  adhikbuilds noreply identity, and `git push` authenticates through a repo-local credential helper; both are already configured.

## Legal guardrails
- Jobs only from public ATS board APIs (Greenhouse boards-api, Lever v0 postings, Ashby posting-api), with recorded fixtures for
  tests/offline dev. Never scrape shortlistapp.co, LinkedIn or Indeed.
- Approved by the owner 2026-10-29; not built yet (see docs/recon/ats-terms-2026-10-29.md). Two more source types are allowed:
  - schema.org `JobPosting` JSON-LD on employer career pages (Workday, SuccessFactors career sites and similar)
  - Zoho Recruit public RSS feeds

  Only under these rules:
  1. Start only from the `Sitemap:` lines in robots.txt, and honour every Disallow.
  2. Read only the JSON-LD block on job pages listed in that sitemap. Never store page HTML.
  3. At most 1 request per second per host, with an honest user agent, and back off on 429 and 5xx errors.
  4. Never call undocumented APIs (for example Workday `/wday/cxs/`), log in, submit an application, or bypass a bot check or CAPTCHA.
  5. Add each host to the allowlist by hand, with a dated note recording that robots.txt and the site terms were read.
  6. Stop within 24 h when an employer asks.
  7. Every card links back to the source with "read Nh ago".
- No auto-submission in MVP: draft → user approves → 4s undo → hand off to the employer's own form. Headless submission is a later,
  feature-flagged phase with per-application approval.
- Resumes are PII: encrypt at rest, never log contents, never send to an LLM without the user's consent toggle.

## When PLAN.md and this file disagree
This file wins on process: who builds what, the agent roster, git, ports. PLAN.md wins on product scope and acceptance criteria.
UI is built by the main session after loading `frontend-design`; `tdd-guide` owns logic plus its tests.
