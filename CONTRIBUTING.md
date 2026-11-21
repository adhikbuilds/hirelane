# Contributing to HireLane

Thanks for helping. HireLane is a job board built from public ATS APIs plus an application agent for students. Contributions of every size are welcome: a new job board source, a bug fix, a test, a doc fix.

## Find something to work on

- Issues labelled [`good first issue`](https://github.com/adhikbuilds/hirelane/labels/good%20first%20issue) are small and self-contained.
- Issues labelled [`help wanted`](https://github.com/adhikbuilds/hirelane/labels/help%20wanted) are bigger.
- Comment on the issue before you start so two people don't build the same thing. If an issue has had no activity for a week after someone claimed it, it's fair game.

## Run it locally

You need Node 22.18 or newer (see `.nvmrc`), pnpm 9 and Docker.

```bash
pnpm install
cp .env.example .env.local      # defaults work for local development
pnpm setup:keys                 # generates local-only secrets into .env.local
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm dev                        # http://localhost:3001
```

Everything runs offline by default: ingest reads recorded fixtures, the LLM runs in `fixture` mode and embeddings use a hash. You do not need any API keys to work on HireLane.

## Before you open a pull request

```bash
pnpm verify
```

This is what CI runs: unit tests, typecheck, package boundaries (`lint:deps`), the product guards, the engine evaluation, and the schema, row-level-security and auth checks. A PR needs it green.

Guidelines:

- **Tests first for logic.** Anything in `packages/engine` should come with a test that fails without your change.
- **Keep package boundaries.** `pnpm lint:deps` enforces them; see the table in the README.
- **Migrations are append-only.** Add a new numbered SQL file; never edit one that has already run (the runner checks checksums).
- **No scraping.** Job data comes from public ATS APIs (Greenhouse, Lever, Ashby). Never add sources that need logins, bypass bot checks or CAPTCHAs, or scrape page HTML. Any other source type has to follow the rules in `CLAUDE.md` (Legal guardrails) and be approved in an issue first.
- **Never submit without the student's explicit consent.** `pnpm no-submit-guard` enforces the submit gate; don't weaken it.
- One logical change per PR, with a short description of what changed and how you tested it.

## Adding a job board

Boards live in `packages/ingest/boards.json`. To add one:

1. Find the company's public board URL (`boards.greenhouse.io/<slug>`, `jobs.lever.co/<slug>`, `jobs.ashbyhq.com/<slug>`).
2. Add an entry with the provider, slug and today's `verified_at`.
3. Run `pnpm ingest:record` for that board to save a fixture, then `pnpm --filter @hirelane/ingest test`.

## Questions

Open a [discussion or issue](https://github.com/adhikbuilds/hirelane/issues). Be kind; see the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
