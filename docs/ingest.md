# Ingest (Phase 1)

> **Status:** describes the uncommitted Phase 1 working tree as of 2026-10-16. Built pieces are stated as built. Gaps are marked **Gap**.
> **Code:** `packages/ingest/` (connectors, run, record), `packages/db/src/ingest/persist.ts` and `packages/db/src/schema/ingest.ts`, migrations `0002_companies_boards_postings.sql` and `0003_ingest_runs.sql`, `workers/runner/src/tasks/ingest.ts`, `workers/runner/crontab`, `apps/web/app/ops/ingest/`.
> Codemap: `docs/architecture.md` §4 and §6.

---

## 1. Sources and endpoints

Ingest reads public job-board list endpoints from three ATS providers. It never fetches a free-form URL. Each request URL is built from a configured board token, and the token is checked against `^[A-Za-z0-9._-]{1,100}$` and URL-encoded before use. Only `https:` is allowed.

| ATS | List endpoint (GET) | Envelope | Item id | Notes |
|---|---|---|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | `{ jobs: [] }` | numeric `id`, stringified | `content` is HTML entity-encoded and is decoded once. No pay in the list response, so `compensation` is always null. |
| Lever | `https://api.lever.co/v0/postings/{token}?mode=json` | top-level array | string `id` | `description`, `lists[]` and `additional` are plain HTML. `salaryRange` is optional. A `0..0` range means no figure. |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true` | `{ jobs: [] }` | string `id`, or the UUID in `jobUrl` | Items with `isListed: false` are excluded from postings and from the seen set. `descriptionHtml` is plain HTML. Equity is never emitted as pay. |

### Board config

- `packages/ingest/boards.json` is the list of boards ingest runs. It has 119 entries: 80 Greenhouse, 28 Ashby, 11 Lever. A board loads only if it has a `verified_at` stamp and a recorded `http_status` of 200.
- `packages/ingest/boards.candidates.json` is the input to the recorder. It has 154 candidates.
- Tokens come from config only. The worker re-resolves them from `boards.json` and never trusts a job payload.

### Field mapping

Each connector maps the ATS fields to a `RawPosting`, which `normalize()` turns into the `postings` columns.

| Posting field | Greenhouse | Lever | Ashby |
|---|---|---|---|
| `title` | `title` | `text` | `title` |
| `url` | `absolute_url` | `hostedUrl` | `jobUrl` |
| `applyUrl` | same as `url` | `applyUrl` | `applyUrl` |
| location(s) | `location.name`, then `offices[]` | `categories.location`, then `allLocations` | `location`, then `secondaryLocations[]` |
| description | `content` (decoded once) | `description` + `lists[]` + `additional` | `descriptionHtml` |
| department / team | `departments[0].name` / none | `categories.department` / `categories.team` | `department` / `team` |
| employment / workplace | `metadata` entries with matching names | `categories.commitment` / `workplaceType` | `employmentType` / `workplaceType` |
| `postedAt` | `first_published` (never `updated_at`) | `createdAt` | `publishedAt` |
| pay | none | `salaryRange` | `compensation` tiers (salary first, then OTE/commission, equity dropped) |

**Verification status of these paths.** Connector comments record that Greenhouse `content` is entity-encoded (checked on `fixtures/mini/greenhouse/airtable`), that Lever HTML is plain (checked on `fixtures/mini/lever/cred`), that Ashby `descriptionHtml` is plain (checked on `fixtures/mini/ashby/*`), and that Lever `salaryRange` maps across the full recorded Lever boards. Every other path is covered only by unit tests against hand-built inputs. Treat those as assumptions until a fixture check confirms them.

---

## 2. Modes

| Mode | Reads from | Selected by |
|---|---|---|
| `fixture` | gzipped bodies in `packages/ingest/fixtures/full/{ats}/{token}.json.gz` | default. `HIRELANE_INGEST_MODE` unset or `fixture` |
| `live` | the ATS APIs above | `HIRELANE_INGEST_MODE=live`, or `--mode live` on the CLI |

- The CLI is `pnpm ingest:run -- --mode fixture|live`. It also takes `--fixtures-dir`, `--inject-status ats:token=STATUS` (fixture mode only, repeatable) and `--concurrency 1..32`. `--mode` wins over the env var.
- Fixture mode serves only URLs of configured boards. A board with no fixture file gets a 404 and fails alone.
- **Important:** the cron in the worker also defaults to fixture mode. Set `HIRELANE_INGEST_MODE=live` on the worker to fetch real data on the schedule.

---

## 3. Cadence and run lifecycle

**Schedule.** `workers/runner/crontab` runs `7 */6 * * * ingest:schedule`, so four runs a day at minute 7 of hours 0, 6, 12 and 18 on the worker's clock. The worker should run in UTC. That is a known **Gap** (see §9).

**One run:**

1. `ingest:schedule` checks for a run that is still `running` and started within the last 2 hours. If one exists, it logs a warning and skips this tick.
2. It loads the verified boards, upserts their company and board rows, and inserts an `ingest_runs` row with `trigger = cron`.
3. It enqueues one `ingest:source` job per board. Each job goes on queue `ingest-{ats}`, so the boards of one ATS run one at a time against its single host. Each job has `jobKey ingest:source:{runId}:{boardId}` and `maxAttempts 5`.
4. It enqueues `ingest:finalize` with a deadline of now + 45 minutes. The job first runs after 15 seconds and then re-queues itself every 15 seconds.
5. Each `ingest:source` job does nothing if the run is no longer `running` or if this board already committed for this run. Otherwise it fetches the board, normalises it and commits it in one transaction (§4).
6. `ingest:finalize` waits until every board has committed or the deadline has passed. It then records any board that never committed as failed, soft-closes postings, and writes the run totals.

**Run status.** `ok` when no board failed or came back empty-suspect. `partial` when some boards succeeded. `failed` when none succeeded.

**CLI.** `pnpm ingest:run` does the same work in one process, with no queue. It uses trigger `manual`, or `fixture` in fixture mode. Its default concurrency is 6 in live mode and 8 in fixture mode. It exits 1 when the run status is `failed`.

**Recording.** A failed fetch writes one `ingest_source_runs` row with status `failed` and bumps `company_boards.consecutive_failures`. It does not touch any posting.

---

## 4. Soft-close rule

A posting is never deleted. It is closed by setting `closed_at`. The rule is:

1. **Successful board commit.** Every item seen in the listing, including items that failed to normalise, has `missed_runs` reset to 0 and `last_seen_at` set to now. A posting that is open in the DB but absent from the listing has `missed_runs` incremented by 1. Postings that were closed and are seen again are reopened (`closed_at` cleared) and rewritten.
2. **Finalize.** Every open posting with `missed_runs >= 2` is closed with `closed_at = now`. Each close is attributed to the run's source row for that board.
3. **Net effect.** A posting closes after it has been missing from two successful board commits in a row. At the 6-hour cadence that is at least two successful runs, so roughly six hours after the first miss, not two days.
4. **Failed fetch.** Changes nothing. `missed_runs` does not move. This is the outage guard.
5. **Empty-board guard.** A 2xx response with zero listings for a board that still has open postings is recorded as `empty_suspect`. It counts as a failed fetch for soft-close purposes, and no posting changes.
6. **Operator close.** `closeBoard()` in `@hirelane/db` closes every open posting on one board at once. It is for a board that has really emptied. It has no cron path.
7. **Content change.** A posting whose `content_hash` changes is rewritten, counted as `changed`, and given the new content. `CONTENT_HASH_VERSION` is `v1`. Bump it only on a deliberate definition change, because that re-enriches every posting.
8. **Duplicates.** If the same id appears twice in one listing, the first one is kept and the rest are reported as `duplicate_id`.

---

## 5. Rate limits and fetch policy

| Control | Value | Where |
|---|---|---|
| Per-host spacing, live | at least 1000 ms between request starts to the same host | `createHostLimiter` in `record/limiter.ts`, used by `createPolicyFetch` (`run/policy.ts`). The CLI and the worker each create their own limiter. |
| Per-host spacing, recorder | 1000 ms | `recordBoards`, `minIntervalMs` |
| Request timeout | 30 s, covering headers and body | `TIMEOUT_MS` |
| Body cap | 20 MiB, checked on `content-length` and while streaming | `MAX_BYTES` |
| Board retries, live | up to 3 attempts. Backoff 1 s base, doubling, capped at 30 s, with 50 to 100 percent jitter. A server `Retry-After` is honoured up to 60 s. | `run/retry.ts` |
| Board retries, fixture | same attempts, no delay | `defaultRetryPolicy` |
| Retryable | timeout, network error, 429, any 5xx | `isRetryable` |
| Not retried | 404, other 4xx, invalid JSON, schema mismatch, body over the cap | `isRetryable` |
| Recorder retry | one retry after 2 s, or after `Retry-After` capped at 30 s, on network error, 429 or 5xx | `recordBoards` |
| Concurrency | 6 boards (CLI live), 8 (CLI fixture), worker 4 (**Gap**: ingest expects 8) | `runIngest`, `workers/runner/src/index.ts` |
| Worker task retries | `ingest:source` `maxAttempts 5`. A failed fetch is recorded, not thrown, so graphile-worker retries only on thrown errors such as DB errors or an unknown board. | `tasks/ingest.ts` |

**User-Agent.** Live fetches send `HirelaneBot/0.1 (+http://localhost:3001/contact)`. The contact URL is a dev placeholder. See §8.

**Scope of the limiter.** Spacing holds only within one process. Two worker processes would each keep their own clock.

---

## 6. How to re-record fixtures

Recording is live, manual and never runs in CI. The script exits with code 2 if `CI` is set.

1. Edit `packages/ingest/boards.candidates.json` if the candidate list changes.
2. Run `pnpm ingest:record`, which is `pnpm --filter @hirelane/ingest record`. It runs `src/record/cli.ts` at 1 request per second per host. A full pass takes about as long as the host with the most candidates needs, plus any retries.
3. The recorder overwrites:
   - `packages/ingest/boards.json`, with a new `verified_at` on every board it kept and the recorded `http_status`, `postings` and `hires_in_india` values;
   - `packages/ingest/fixtures/full/{ats}/{token}.json.gz`, byte-exact gzipped bodies;
   - `packages/ingest/fixtures/mini/...`, a copy of 5 boards chosen by `deriveMini()`. The required Ashby boards are `openai`, `benchling` and `temporal`, plus the smallest Greenhouse and Lever boards that have at least 5 postings;
   - `packages/ingest/fixtures/full/manifest.json`, which records totals, the `trimmed` list, the `mini` list and the `dropped` list.
4. Budget: the total gzipped size must fit in 25 MiB. If it does not, the recorder blanks descriptions after the first 200 postings, largest boards first. Those boards are listed under `trimmed` in the manifest and are **not** byte-exact.
5. Dropped candidates have reasons such as `http_404`, `empty`, `too_large`, `invalid_json`, `schema` or `bad_token`. The last recording (2026-10-15) kept 119 of 154 and dropped 35: 30 for 404, 3 empty and 2 too large.
6. Check the result: run `pnpm --filter @hirelane/ingest test` and `pnpm --filter @hirelane/ingest typecheck`. Confirm that `boards.json` and the fixture files agree. Fixture mode fails any configured board that has no fixture file.
7. Review the diff before committing. Fixture bodies are public job data, so the review in §8 applies to any new board.

There is no per-board re-record command. A full run rewrites every board.

---

## 7. Tests

`pnpm --filter @hirelane/ingest test` runs 12 files and 166 tests. They passed on 2026-10-16. They cover:

- connector mapping against mini fixtures;
- normalisation and the content hash;
- the fetch policy: the 20 MB cap, the 30 s timeout, host spacing and non-https refusal;
- the retry rules;
- fixture-mode transport and `--inject-status`;
- argument parsing;
- the recorder, including budget trimming and mini derivation;
- end-to-end runs over fixtures: idempotence, the two-miss close, the 500 across three runs, and a board with no fixture.

Persistence is tested in `packages/db/test/ingest-persist.test.ts` and worker wiring in `workers/runner/test/ingest.tasks.test.ts`. Those suites need a Postgres database and were not run for this document.

---

## 8. Per-ATS terms checklist

> **Needs human review.** Nothing in this section is a legal or licensing conclusion. The items are questions to answer from each provider's current terms, from the company's own consent, and from counsel where needed. Each item is unchecked until a named reviewer marks it.

### Greenhouse (`boards-api.greenhouse.io`)

- [ ] **Needs human review:** confirm the public Job Board API is intended for third-party read use, and record the terms version reviewed.
- [ ] **Needs human review:** confirm whether full `content` HTML may be stored and redisplayed, or only excerpts.
- [ ] **Needs human review:** confirm any required attribution or link-back to the original posting.
- [ ] **Needs human review:** confirm the published rate limit, if any, and that the 1 req/s spacing meets it.
- [ ] **Needs human review:** confirm storage and retention limits for the raw `jsonb` body (`postings.raw`).

### Lever (`api.lever.co`)

- [ ] **Needs human review:** confirm the Postings API terms allow aggregation of public postings.
- [ ] **Needs human review:** confirm whether `description`, `lists` and `additional` may be redisplayed, and whether `salaryRange` may be shown.
- [ ] **Needs human review:** confirm any rate limit or required headers.
- [ ] **Needs human review:** confirm retention limits for stored bodies.

### Ashby (`api.ashbyhq.com`)

- [ ] **Needs human review:** confirm the Posting API terms cover read use by third parties.
- [ ] **Needs human review:** confirm the rules for showing compensation from `includeCompensation=true`. Pay display may be restricted by jurisdiction or by the employer's settings. The `shouldDisplayCompensationOnJobPostings` flag is respected in code, but its legal meaning still needs review.
- [ ] **Needs human review:** confirm whether unlisted (`isListed: false`) postings may be stored, even briefly.
- [ ] **Needs human review:** confirm rate limits and retention.

### Across all three

- [ ] **Needs human review:** per-company permission. Decide whether a company must opt in, or can opt out, before its board is ingested. The current model is config-only.
- [ ] **Needs human review:** the User-Agent contact URL is `http://localhost:3001/contact`, a dev placeholder. Replace it with a real contact page before any live run.
- [ ] **Needs human review:** personal data. Ingest is expected to hold no personal data, but postings can name recruiters or hiring managers in free text. Confirm how that text is handled.
- [ ] **Needs human review:** data residency and the India hiring flag (`hires_in_india`). Confirm whether any rule depends on it.
- [ ] **Needs human review:** takedown process. Decide how a company's request to remove its postings is handled. The operator close (§4) is the only tool today.

---

## 9. Known gaps

- `packages/ingest/src/index.ts` does not exist, but `packages/ingest/package.json` names it as `main` and `types`. Workers import `@hirelane/ingest/src/...` paths directly.
- Worker concurrency is 4 in `workers/runner/src/index.ts`. Ingest expects 8, which is architecture §4.1 and §7 item 8.
- `TZ` is not set for the worker, so the cron time is only UTC by assumption.
- Live rate limiting is per process, not global.
- The changes are uncommitted.
