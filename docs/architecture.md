# Hirelane architecture

> Status: Phase 0 (task 0.2, architect), reconciled against the working tree on 2026-10-16. The public board and API (Phase 3) were added to the codemap on the same date; their contract is in `docs/public-api.md`.
> Each section says whether it describes what is **built** or what is **planned**. Every path in the codemap (§6) is tagged with the phase that creates it. Nothing tagged P1 or later exists yet.
> PLAN.md §5, §6 and §10 are the source of truth. Where this document goes beyond them, or where the build differs from them, it says so under **Gap** or **Note**.
> `doc-updater` keeps this codemap current (task 0.11).

---

## 1. Conventions inherited from solum

| Area | Rule | Status |
|---|---|---|
| Workspace | pnpm `9.12.0` (`packageManager`), `engines.node >= 20`, globs `packages/*`, `apps/*`, `workers/*` | Built (`package.json`, `pnpm-workspace.yaml`) |
| Package shape | Scope `@hirelane/*`, `"private": true`, `"type": "module"`, `"main"` and `"types"` both `./src/index.ts`. Consumed from source, no build step. Internal deps use `workspace:*` | Built for `db`. **Note:** `workers/runner` (named `@hirelane/runner`, not `@hirelane/worker`) has `main` but no `types`, and uses `workspace:^`. `packages/engine` has no `package.json` yet |
| Scripts | Package scripts run TypeScript through `vite-node` (`"migrate": "vite-node src/migrate.ts"`). Root scripts delegate with `pnpm --filter @hirelane/<pkg> <script>` | Built |
| TypeScript | `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`. Every package has `typecheck: tsc --noEmit` | Built for `db`, `runner`, `web`. **Gap:** `engine` has no package and so no typecheck script |
| Tests | Vitest for unit tests, Playwright for e2e on `http://localhost:3001` in fixture mode | Vitest is configured as a root `vitest.config.ts` using `projects` (not a `vitest.workspace.ts`). Playwright lives at `apps/web/playwright.config.ts`. **Gap:** its `globalSetup` that runs `db:fresh` is not yet present |
| `.env` discovery | Walks up from `process.cwd()` to find the repo-root env file. Host-provided `DATABASE_URL` skips the walk | Built in `packages/db/src/env.ts` (`loadEnv`), not `client.ts`. It looks for `.env.local` first, then `.env`, up to six levels up. `import.meta.dirname` is not used for this |
| TLS | TLS with `rejectUnauthorized: true` is forced for any `DATABASE_URL` host that is not localhost, whatever `sslmode` says | Built for the `pg` pool (`getPool` in `client.ts`). **Gap:** not applied to the graphile-worker connection (`workers/runner/src/index.ts`) or to `addJob`, which pass the raw URL |
| Pooled endpoints | `migrate` refuses a transaction-mode pooler (a `-pooler.` host). graphile-worker needs a direct connection for LISTEN/NOTIFY | **Gap:** not implemented. `migrate.ts` and `migrator.ts` contain no pooler check, and nothing checks the worker's endpoint |
| Tenant context | `withUser(userId, fn)` runs `BEGIN` → `SET LOCAL ROLE hirelane_app` → `set_config('hirelane.user_id', $1, true)` → `fn` → `COMMIT`. The scope is transaction-local, so a pooled connection cannot leak one user's context into the next request | Built (`client.ts`). **Gap:** see §3.2. The migrations do not yet grant the owner membership in `hirelane_app` |
| Admin context | `withAdmin(fn)` runs as the owner. Only migrations, seed, ingest, ops and system sweeps may use it (PLAN §10) | Built (`client.ts`). Used by `migrate`, `verify-schema`, `reset` and `seed` |
| Database | Image `pgvector/pgvector:pg16`, not solum's `postgres:16-alpine`, because that image has no pgvector. Container `hirelane-postgres`, port `127.0.0.1:5433:5432`, volume `hirelane-pgdata`, `pg_isready` healthcheck | Built (`docker-compose.yml`). `docker/initdb/01-create-test-db.sql` also creates `hirelane_test` on first start, for `TEST_DATABASE_URL` |

---

## 2. Package dependency rules

### 2.1 Ownership and allowed imports (PLAN §5.2)

| Package | Name | Owns | May import | Must not | Status |
|---|---|---|---|---|---|
| `packages/engine` | `@hirelane/engine` | Salary, skills, requirements, classifiers, dedup keys, match score, autopilot rules, reply and question classifiers. Exports `ENGINE_VERSION`. Every result carries a `Trace` | nothing (zero runtime deps) | Use network, DB, the clock (`now` is injected), or randomness | Planned (P2). `src/index.ts` is a placeholder (`export const x=1`). No `package.json`, no `ENGINE_VERSION` |
| `packages/db` | `@hirelane/db` | `client.ts` (`withAdmin`, `withUser`, `getPool`, `close`), `migrate.ts`, `migrator.ts`, `reset.ts`, `seed.ts`, `verify-schema.ts`, `queue.ts` (`addJob`), Drizzle schema in `src/schema/*.ts` | `pg`, `drizzle-orm`, `graphile-worker` (see §2.3) | Contain business logic | Built (P0). `verify-rls.ts`, `verify-auth.ts` and `auth.ts` are planned (P4) |
| `packages/ingest` | `@hirelane/ingest` | Connectors (`greenhouse.ts`, `lever.ts`, `ashby.ts`) → `RawPosting`, recorder, `boards.json`, fixtures, persistence and diff | `db` | Enrichment or LLM calls | Planned (P1) |
| `packages/agent` | `@hirelane/agent` | `llm/`, `embeddings/`, resume parsing, drafting, approval state machine, handoff payload and per-ATS capabilities, tailoring, `mail/`, `submit/` (P9, flagged) | `engine`, `db` | Any HTTP call to an ATS application endpoint outside `src/submit/` | Planned (P2 onward) |
| `workers/runner` | `@hirelane/runner` | graphile-worker bootstrap, tasks, crontab | all packages | Contain UI | Built, partially (P0): `heartbeat` task and crontab only |
| `apps/web` | `@hirelane/web` | Pages, server actions, route handlers, `lib/{queries,session,format}.ts` | `db`, `engine`, `agent` | Import `ingest` or `workers` | Built, P0 to P3 (uncommitted): the public board, job, list and company pages, the public API route handlers, markdown negotiation, `llms.txt`, sitemaps and `robots.txt`. It depends on `@hirelane/db` (`withAdmin`) and `@hirelane/engine` (role families, places). **Still stubs:** `lib/queries.ts` (`getFreshestJobs`) and `lib/session.ts`. Sessions arrive in P4 |

### 2.2 Forbidden edges

`pnpm lint:deps` runs dependency-cruiser (`.dependency-cruiser.cjs`) over `packages`, `apps` and `workers`. It is part of `pnpm verify`. Every rule has `severity: error`.

The rules that exist today, with their ids in the config:

| Rule id (config) | From | To (forbidden) | Why |
|---|---|---|---|
| `engine-is-pure` | `packages/engine/src` | other `packages/*`, `apps/`, `workers/`, and `node_modules/(pg\|drizzle-orm\|graphile-worker)` | Engine output must be deterministic and replayable. **Note:** the config does not yet forbid Node builtins (`net`, `http`, `fs`, `crypto` and so on) or other npm packages |
| `db-no-business-logic` | `packages/db/src` | any other `packages/*` (except db), `apps/`, `workers/` | db is infrastructure. **Note:** stricter than PLAN §5.2, which allows engine data as a devDependency for seeds. Revisit when `seed.ts` needs engine fixtures |
| `ingest-only-db` | `packages/ingest/src` | any `packages/*` except `ingest` and `db`, `apps/`, `workers/` | Ingest stores raw postings and never enriches. **Note:** it does not forbid `@anthropic-ai/*` from `node_modules`, so the no-LLM rule is only partly enforced |
| `agent-engine-db` | `packages/agent/src` | any `packages/*` except `agent`, `engine` and `db`, `apps/`, `workers/` | Agent may import engine and db. This also keeps `agent` from importing `ingest`, so the one-way rule holds |
| `web-boundaries` | `apps/web/` | `packages/ingest`, `workers/` | Web enqueues through `addJob` and never runs jobs inline. **Note:** graphile-worker is not forbidden directly, which is covered by `addJob` being the only path |
| `workers-not-imported` | anything outside `workers/` | `workers/` | Workers are leaves |
| `no-circular` | `*` | circular | |

Rules in the ADR's original table that are **not yet in the config**: `nothing-imports-apps` (`packages/*` and `workers/*` must not import `apps/*`) and `submit-is-isolated` (anything outside `packages/agent/src/submit/` must not import it). Add both when `agent` and `submit/` land.

Two source-text guards, also run in `verify`, complement the import rules:
- `scripts/no-submit-guard.ts` fails on any reference to an ATS application-submission host or path (Greenhouse `job_app` and applications API, Lever `/apply` and `api.lever.co/v0/postings/.../apply`, Ashby application and `applicationForm.submit`) outside `packages/agent/src/submit/`. It skips `docs/`, `PLAN.md`, `CLAUDE.md` and the lockfile. Read-only ingestion endpoints are deliberately not listed. Self-tests are in `scripts/test/no-submit-guard.test.ts`.
- `scripts/brand-guard.ts` fails on banned brand strings in product surfaces. `docs/` and `PLAN.md` are not product surfaces. Self-tests are in `scripts/test/brand-guard.test.ts`.

Engine's ban on the clock and on randomness is **not yet enforced** by a rule or a guard script. The chosen mechanism is due in Phase 2 (§7, item 5).

### 2.3 `queue.ts` and the enqueue role

PLAN §5.2 lists `pg` and `drizzle-orm` as db's only imports. In practice `packages/db/src/queue.ts` wraps graphile-worker's `quickAddJob`, so `@hirelane/db` also depends on `graphile-worker`. The table above reflects that. Keeping `queue.ts` in db is deliberate: it is what lets `apps/web` enqueue without importing the worker.

`hirelane_app` has **no grants** on the `graphile_worker` schema (PLAN §6). An `addJob` call made inside a `withUser` transaction would therefore fail with a permission error. The rules are:
- `addJob` always runs on the owner connection, outside any `withUser` transaction, and **after** the user transaction commits.
- Idempotency comes from `jobKey`, not from transactional enqueue, so a crash between the commit and the enqueue is repaired by the next trigger or sweep.
- Where the enqueue must be atomic with a write (webhooks: verify, persist, enqueue), the handler does both under `withAdmin` in a single transaction. `graphile_worker.add_job` is then called on the same owner connection.

**Note:** these rules are conventions. `addJob` takes a connection string and does not check whether it is inside a `withUser` transaction. It reads `DATABASE_URL` from `process.env` directly, so the caller must load the env first (the runner does this through `requireDatabaseUrl`). It also does not apply the TLS rule from §1.

---

## 3. ORM and migration decision

**Decision.** Drizzle supplies the typed schema and query builder. Hand-numbered SQL migrations are the only way DDL reaches a database.

| Concern | Choice | Status |
|---|---|---|
| Schema types | `packages/db/src/schema/*.ts` (Drizzle `pg-core`). It mirrors the SQL and never generates it | Built for the three ops tables (`schema/ops.ts`) |
| Queries | Drizzle query builder over the `PoolClient` that `withUser` or `withAdmin` hands in, so RLS context and role apply to every Drizzle query. Raw `client.query` stays allowed for SQL Drizzle cannot express (HNSW KNN ordering, `REFRESH MATERIALIZED VIEW CONCURRENTLY`, `set_config`) | `getDb()` exists in `client.ts` but has no callers yet. The heartbeat task uses raw `client.query` |
| Migrations | `packages/db/migrations/NNNN_<name>.sql`, applied in lexical order by `migrate.ts` | Built. Only `0001_foundation.sql` exists |
| Runner | Ported from solum. Creates `schema_migrations(name text pk, checksum text, applied_at timestamptz)`, computes `sha256(file)` (first 16 hex characters) per file, skips files whose checksum matches, **refuses** an applied file whose checksum has changed, applies each new file in its own `BEGIN … COMMIT` and records it, and rolls back with the file name on failure. It refuses a pooled endpoint | Built in `migrator.ts`, except the pooler refusal (**Gap**, see §1) |
| Drizzle Kit | `drizzle-kit push` and `drizzle-kit generate` are **never** used. There is no `drizzle.config.ts` and no `drizzle-kit` dependency | Confirmed absent |
| Drift | `verify-schema.ts` (via `verify-schema-lib.ts`) compares the Drizzle schema with `information_schema` and exits non-zero on a missing or extra table or column, or on a nullability mismatch. It runs in `pnpm verify` | Built for tables, columns and nullability. **Gap:** the ADR also requires type and `pg_indexes` checks. Neither is implemented, so the unique index on `feature_flags` and the HNSW and trigram indexes to come are not covered |
| pgvector | Drizzle `vector({ dimensions: 384 })` from `drizzle-orm/pg-core` `[assumption: confirm in Phase 0; fall back to customType]`. Each embedding row also stores `embedding_model`, and a provider change means a new migration plus the `embed:reindex` task | **Still unconfirmed.** No vector column exists yet, so the Drizzle `vector` type has not been exercised. Confirm in the first phase that adds one |
| Roles | Owner (the connection user) owns every object. `hirelane_app NOLOGIN` owns nothing. Migrations `GRANT hirelane_app TO current_user` (tolerating `duplicate_object` and `invalid_grant_operation`, as solum does) so that `SET LOCAL ROLE` works from the owner connection | **Gap:** no migration grants this yet (a search for `GRANT hirelane_app` finds nothing). A local superuser owner does not need it, so Docker hides the gap. A non-superuser owner would fail at `SET LOCAL ROLE`. Add the grant in the next migration |

**Migrations named by the plan:**
- `0001_foundation.sql` (**built**): extensions `vector`, `pg_trgm`, `citext`, `pgcrypto`; role `hirelane_app NOLOGIN` (created idempotently, since roles are cluster-wide); tables `worker_heartbeats` (index `worker_heartbeats_at_idx`), `feature_flags` (unique index on `key, coalesce(user_id, nil uuid)`), `rate_limits` (primary key `(bucket, window_start)`). It also grants `USAGE` on `public` to the app role, `SELECT` on `feature_flags`, and `SELECT, INSERT, UPDATE, DELETE` on `rate_limits`.
- `0005_auth.sql` (planned, P4): `users`, `sessions` (revoked from the app role), `email_tokens`.
- `0006_profiles_resumes.sql` (planned, P4): `profiles`, `work_authorizations`, `answer_bank`, `resumes`, all with RLS.

Other numbers are assigned by the phase that needs them. They are not pre-allocated here.

**Phase 0 tests (built):**
- An edited, already-applied migration is refused (`packages/db/test/migrator.test.ts`). The same file also covers idempotent re-runs, rollback on a failing migration, and the real foundation migration.
- A drift check catches a column missing from the database (`packages/db/test/verify-schema.test.ts`). The same file also catches a stray column, a missing table, and no drift on a fresh database.

**Trade-offs**
- *Pros:* reviewers read exactly the DDL that runs. RLS policies, grants, partial, HNSW and trigram indexes and materialized views are first-class SQL instead of ORM workarounds. The schema still gets compile-time query types. The checksum runner makes silent divergence between databases impossible.
- *Cons:* each schema change is written twice (SQL plus Drizzle). The drift check is the safety net, and it is narrower than the ADR asks for today (see the Gap above).
- *Alternatives (architect's note, not plan text):* Drizzle Kit migrations were rejected because they cannot express RLS or grants cleanly and their diffs are opaque. Raw SQL with no ORM, as in solum, was rejected because Hirelane has far more tables and queries, and untyped rows are where bugs hide. Prisma was rejected because of its heavier runtime and engine binary, and because it hides SQL.

### 3.1 Open item: FORCE RLS versus `withAdmin`

PLAN §6 requires `ENABLE` **and** `FORCE ROW LEVEL SECURITY` on every user-owned table, with policies scoped `TO hirelane_app`. Solum's `0005_role_separation.sql` removed FORCE for the following reason:
- with FORCE, a **non-superuser** owner, such as a managed Postgres owner role, is itself subject to RLS;
- it has no matching policy, so it sees zero rows.

Local Docker hides this because the owner there is a superuser.

Several Hirelane `withAdmin` paths read across users and would silently return nothing on such a host: `application:commit-expired`, `retention:purge`, `ops:freshness`, `/ops/*`, export and delete. **This is unresolved.** No user-owned table exists yet, so nothing is at risk today. The options are:

1. Grant the owner `BYPASSRLS` explicitly. FORCE stays, and admin intent is explicit.
2. Keep FORCE and run every cross-user sweep as per-user `withUser` iterations. This exercises RLS more, but is slower and awkward for aggregates.
3. Follow solum and drop FORCE. The app role owns nothing, so ordinary RLS already applies to it.

Until this is decided, `verify-rls` must include a check that runs as a **non-superuser** owner, so the failure cannot hide behind Docker's superuser. `db:verify-rls` is currently a stub that echoes "not implemented until Phase 4".

---

## 4. Queue decision

**Decision.** graphile-worker on the same Postgres (`graphile-worker` `^0.18.0`).

**Rationale (PLAN §5.2):**
- `jobKey` dedup and replace, used for per-board, per-posting, per-user and per-application keys;
- a built-in crontab;
- LISTEN/NOTIFY wake-up, which keeps latency low without polling;
- a TypeScript API.

It manages its own `graphile_worker` schema, and `hirelane_app` has no grants on it. It also needs no extra infrastructure and runs fully offline, which the Phase 0 acceptance requires (`db:fresh` and `worker` must work with the network disabled).

**Alternatives (architect's note, not plan text):**
- BullMQ was rejected because it needs Redis, a second stateful service with its own backup story.
- pg-boss is viable, but graphile-worker's `jobKey` replace semantics and crontab map more directly onto the task table below.

### 4.1 Mechanics

| Requirement | Mechanism | Status |
|---|---|---|
| "8 global" for `ingest:source` | Worker `concurrency` covers all tasks in a process. Ingest's global cap of 8 is enforced by running ingest at worker `concurrency: 8`. If other task classes need a different cap, they get a separate runner process `[assumption: one process in Phase 0–1]` | **Gap:** `workers/runner/src/index.ts` runs at `concurrency: 4`. Set it to 8 when ingest lands |
| "1 per host" | `queueName: 'host:<hostname>'` on `ingest:source` and `company:logo`. graphile-worker runs jobs in a named queue strictly one at a time. The **1 request per second** limit inside a task is a separate in-process limiter in `@hirelane/ingest`, because queue serialisation alone does not throttle. Named queues carry a throughput cost, so they are used only where serialisation is required | Planned (P1, P3) |
| Singletons | A fixed `jobKey` (for example `ops:freshness`). Cron items also rely on the crontab's own once-per-tick guarantee | Planned |
| Replace semantics | `jobKeyMode: 'replace'` for `match:user-full`, so the latest resume or profile change wins | Planned (P4) |
| Retries | graphile-worker exponential backoff (`maxAttempts` per task). Ingest's HTTP retries (3, honouring `Retry-After` on a 429) happen inside the task | Planned (P1). No `maxAttempts` set yet |
| Time zone | The worker runs with `TZ=UTC`, so `03:30` means 03:30 UTC unambiguously | **Gap:** neither the `worker` script, the runner code nor `.env.example` sets `TZ`. Add `TZ=UTC` to the worker's environment |
| DB access in tasks | `withAdmin` for ingest and ops. `withUser(userId)` for anything per-user, so RLS stays exercised (PLAN §10) | `heartbeat` uses graphile-worker's own `helpers.withPgClient`, not `withAdmin`. That is acceptable for a system task that writes one table, but it is not the documented pattern |

### 4.2 Crontab (`workers/runner/crontab`)

The intended schedule (PLAN §5.5) is:

```
7 */6 * * *   ingest:schedule
*/15 * * * *  ops:freshness
30 3 * * *    retention:purge
* * * * *     application:commit-expired
* * * * *     heartbeat
0 4 1 * *     company:logo          # monthly refresh; exact slot [assumption]
```

**Built today:** `heartbeat` (`* * * * *`) and `ingest:schedule` (`7 */6 * * *`, Phase 1, uncommitted). The other entries are added by the phase that creates their task. The ingest flow is described in `docs/ingest.md`.

### 4.3 Task catalogue (PLAN §5.5, condensed)

| Task | Trigger | Key / concurrency | Context | Phase | Status |
|---|---|---|---|---|---|
| `heartbeat` | every minute | singleton | system | 0 | Built. Inserts into `worker_heartbeats` and prunes rows older than one day |
| `ingest:schedule` | cron `7 */6 * * *` | singleton | admin | 1 | Built (uncommitted). Skips when a run is `running` and started within 2 hours. Inserts `ingest_runs`, enqueues one `ingest:source` per verified board and one `ingest:finalize`. See `docs/ingest.md` §3 |
| `ingest:source` | schedule | `ingest:source:{runId}:{boardId}` key; queue `ingest-{ats}` (one per ATS host); `maxAttempts 5` | admin | 1 | Built (uncommitted). Fetches one board through `@hirelane/ingest` and commits it in one transaction. Failed fetches are recorded, not thrown. Worker concurrency is 4 (**Gap**: ingest expects 8) |
| `ingest:finalize` | last source done, or a 45-minute timeout | per run; re-queues every 15 s | admin | 1 | Built (uncommitted). Records boards that never committed as failed, soft-closes postings with `missed_runs >= 2`, and writes run totals. See `docs/ingest.md` §4 |
| `enrich:posting` | new or changed posting; `enrich_version` bump | per posting | admin | 2 | Planned |
| `company:logo` | new company, or monthly | per company; SSRF-guarded | admin | 3 | Planned |
| `embed:job` / `embed:resume` / `embed:reindex` | enrich, parse, provider change | per entity | admin / user | 2–4 | Planned |
| `match:user-full` | resume or profile change | per user (replace) | user | 4 | Planned |
| `match:user-delta` | ingest finalize | per user | user | 4 | Planned |
| `agent:parse-resume` | upload | per resume | user | 4 | Planned |
| `agent:draft` | apply click, or autopilot | per application | user | 5 | Planned |
| `resume:render` | tailoring accepted | per version (Playwright PDF) | user | 5 | Planned |
| `application:commit-expired` | every minute | singleton | see §3.1 | 5 | Planned |
| `mail:inbound` / `mail:forward` | webhook | per message id; forward p95 ≤ 60s | admin, then user | 6 | Planned |
| `autopilot:run` | after match delta | per user; drafts only | user | 7 | Planned |
| `digest:send` | autopilot batch | per batch; idempotent through `outbound_messages` | user | 7 | Planned |
| `billing:process-event` | payment webhook | per `event_id` | admin | 7 | Planned |
| `ops:freshness` | cron `*/15 * * * *` | singleton | admin | 8 | Planned |
| `retention:purge` | daily 03:30 UTC | singleton | see §3.1 | 8 | Planned |

---

## 5. Environment variables

`.env.example` lists the variables below with **no secret values**. Secrets are left blank (security review 0.10). Defaults are applied in code when a variable is unset, except where noted.

| Variable | Default | Used by | Secret | Phase | Status and notes |
|---|---|---|---|---|---|
| `DATABASE_URL` | `postgres://hirelane:hirelane@localhost:5433/hirelane` (in `.env.example`) | db, worker, web | yes outside dev | 0 | **Note:** `requireDatabaseUrl` has no code default. It throws if the variable is unset. Must be a direct (non-pooler) endpoint for `migrate` and the worker (pooler check not yet built) |
| `TEST_DATABASE_URL` | `postgres://hirelane:hirelane@localhost:5433/hirelane_test` (in `.env.example`) | db tests | no | 0 | Not in the original ADR table. Added for the `hirelane_test` database created by `docker/initdb` |
| `APP_ORIGIN` | `http://localhost:3001` `[assumption]` | web, ingest recorder (UA `HirelaneBot/0.1 (+APP_ORIGIN/contact)`), mail templates | no | 1 | Not yet in `.env.example` |
| `HIRELANE_INGEST_MODE` | `fixture` | ingest, worker | no | 1 | In `.env.example`. `fixture` reads the gzipped fixtures; `live` calls the ATS APIs. No code reads it yet |
| `HIRELANE_OPS_TOKEN` | none | web `/ops/*` | **yes** | 1 | In `.env.example`, blank. Gates ops until admin roles land in Phase 4 |
| `HIRELANE_LLM_MODE` | `auto` | agent | no | 2 | In `.env.example`. `auto`, `live`, `fixture` or `off` |
| `ANTHROPIC_API_KEY` | none | agent `AnthropicProvider` | **yes** | 2 | In `.env.example`, blank. When absent, `auto` resolves to `fixture` |
| `HIRELANE_MODEL_DRAFT` | `claude-sonnet-5-5` | agent | no | 4 | In `.env.example` |
| `HIRELANE_MODEL_BULK` | `claude-haiku-5-5` | agent | no | 2 | In `.env.example`. Extraction and classification fallback |
| `HIRELANE_EMBEDDINGS` | `hash` | agent, worker | no | 2 | In `.env.example`. `hash` (CI) or `local` (cached in `.cache/models`) |
| `HIRELANE_MASTER_KEY` | none (dev key from `pnpm setup:keys`) | agent and db encryption (AES-256-GCM envelope) | **yes** | 4 | **Gap:** `.env.example` tells the reader to run `pnpm setup:keys`, but no such script exists in `package.json`. Never committed. Rotation re-wraps the data keys (Phase 8) |
| `HIRELANE_REPLY_DOMAIN` | `replies.localhost` in `.env.example` | agent `mail/`, web copy panel | no | 5 | The ADR had "dev value TBD". The file sets `replies.localhost`. Alias `{reply_handle}+{reply_token}@{domain}` |
| Inbound-mail webhook HMAC secret | `[assumption: name TBD]` | web `/api/webhooks/inbound-email` | **yes** | 6 | HMAC-SHA256 over timestamp + body, ±5 minutes. Not yet named (§7, item 4) |
| Mailer / transport config | `[assumption: name TBD]` (dev writes to `.mail/` outbox) | agent `mail/` | **yes** | 6 | Not yet named |
| Razorpay key and webhook secret | `[assumption: name TBD]` | web billing, `billing:process-event` | **yes** | 7 | Provider `fake` in dev. Not yet named |
| Stripe key and webhook secret | `[assumption: name TBD]` | web billing, `billing:process-event` | **yes** | 7 | Provider `fake` in dev. Not yet named |
| `HIRELANE_FAULTS` | empty | ingest (test only) | no | 8 | In `.env.example`, blank. For example `board:500:<token>` |
| `HIRELANE_ENABLE_SUBMIT` | `0` in `.env.example` | agent `submit/` | no | 9 | **Note:** the ADR said "unset", but `.env.example` sets `0`, which the file says must stay `0` by default. Keep `0`. This is one of four independent switches. It must be `1`, **and** a `feature_flags` row, user opt-in and the ATS allowlist must all be present |
| `TZ` | `UTC` | worker | no | 0 | **Gap:** not set anywhere yet (see §4.1) |

`ENGINE_VERSION` is a code constant exported by `@hirelane/engine`, not an environment variable. It does not exist yet.

---

## 6. Codemap

Status key: **[built]** exists and is wired; **[partial]** exists but is a stub or lacks part of its described behaviour; **[planned Pn]** does not exist yet.

```
hirelane/
├─ package.json                  [built P0] pnpm@9.12.0, node>=20. Scripts: dev, worker, test, test:scripts, e2e, typecheck,
│                                           lint:deps, brand-guard, no-submit-guard, verify, db:{up,down,migrate,seed,reset,fresh,
│                                           verify-schema}. db:verify-rls and db:verify-auth are stubs (P4). ingest:run, ingest:record,
│                                           engine:eval, agent:eval, report:coverage and bench:board are stubs that echo "not implemented until Pn"
├─ pnpm-workspace.yaml            [built P0] packages/*, apps/*, workers/*
├─ tsconfig.base.json             [built P0] strict, noUncheckedIndexedAccess
├─ vitest.config.ts               [built P0] root config, `projects` for packages/*, workers/*, scripts (ADR said vitest.workspace.ts)
├─ .dependency-cruiser.cjs        [built P0] rules in §2.2 (partial set)
├─ docker-compose.yml             [built P0] pgvector/pgvector:pg16, 127.0.0.1:5433, hirelane-pgdata
├─ docker/initdb/                 [built P0] 01-create-test-db.sql creates hirelane_test
├─ .env.example                   [built P0] §5, no secret values
├─ .gitignore                     [built P0] .env*, storage/, .mail/, .cache/ (the last three are uncommitted edits)
├─ README.md                      [planned P0, task 0.11] "Running it" section (solum format). Not present yet
├─ CLAUDE.md, PLAN.md             [built] working rules and the phased build plan
├─ docs/
│  ├─ architecture.md             [built P0] this file
│  ├─ ingest.md                   [built P1, uncommitted] Phase 1 ingest: sources, cadence, soft-close, fixtures, rate limits, per-ATS terms checklist (needs human review)
│  ├─ enrichment.md               [built P2] enrichment engine (Phase 2 notes and known gaps)
│  ├─ public-api.md               [built P3, uncommitted] public JSON API, markdown negotiation, llms.txt, sitemaps, CORS, ETag, rate limits
│  ├─ recon/                      [built] Shortlist teardown notes and text (reference only; shots/ and *-text.md are gitignored)
│  ├─ screens/                    [built] phase-0 to phase-3 screenshots (desktop and mobile), committed per phase
│  └─ privacy-model.md            [planned P4]
├─ scripts/
│  ├─ brand-guard.ts              [built P0] self-tests in scripts/test/brand-guard.test.ts
│  └─ no-submit-guard.ts          [built P0] self-tests in scripts/test/no-submit-guard.test.ts
├─ e2e/
│  ├─ support/screens.ts          [built P0] savePhaseScreen(page, N)
│  ├─ phase-0-shell.spec.ts       [built P0] wordmark, Overpass loaded, paper background, health endpoint
│  ├─ phase-1-ingest.spec.ts      [built P1] /ops/ingest is a 404 without the token
│  ├─ phase-2-job.spec.ts         [built P2] INR LPA job shows its pay and the trace
│  ├─ phase-3-board.spec.ts       [built P3] remote, salary-only and country=IN change the count and URL
│  └─ phase-3-a11y.spec.ts        [built P3] axe finds no serious or critical violations on public pages
├─ fixtures/
│  ├─ full/{ats}/{token}.json.gz  [built P1, uncommitted] recorder output, 119 boards, 18,860 postings, 24.6 MB gzipped (budget 25 MB)
│  └─ mini/                       [built P1, uncommitted] 5 boards: ashby openai, benchling, temporal; greenhouse airtable; lever cred
├─ packages/
│  ├─ engine/                     [built P2, uncommitted] @hirelane/engine. Pure and deterministic, zero runtime deps. package.json (test, typecheck, eval scripts), tsconfig, vitest config. ENGINE_VERSION '1.0.0' in src/version.ts, ENRICH_VERSION 1, DOC_FORMAT_VERSION 1. 675 tests in 10 files, passing 2026-10-16. See docs/enrichment.md
│  │  ├─ src/index.ts              [built P2] public exports
│  │  ├─ src/{salary,fx,currency,requirements,skills,places,text,trace,dedup,errors,types,version}.ts   [built P2, uncommitted]
│  │  ├─ src/classify/            [built P2] level, workplace, employment, roleFamily, visa; index.ts re-exports
│  │  ├─ src/internal/tracer.ts   [built P2] evidence helper shared by classifiers and dedup
│  │  ├─ src/{match,autopilot,replies,questions}/   [planned; not in Phase 2]
│  │  ├─ data/                    [built P2] skills.json (1,182 skills), role-families.json, salary-bounds.json, fx_rates.json (illustrative, as of 2026-10-15), places.json
│  │  ├─ scripts/{eval,score}.ts  [built P2] `pnpm engine:eval`; thresholds in score.ts. Corpora in test/corpus/
│  │  └─ test/                    [built P2] one file per module plus corpus.test.ts and the three JSONL corpora
│  ├─ db/
│  │  ├─ package.json             [built P0] exports ".", "./env"; scripts migrate, seed, reset, verify-schema, test, typecheck
│  │  ├─ migrations/NNNN_*.sql    [built P0] 0001_foundation.sql. 0002_companies_boards_postings.sql and 0003_ingest_runs.sql [built P1, uncommitted]. 0005_auth, 0006_profiles_resumes [planned P4]; others per phase
│  │  ├─ test/                    [built P0] migrator.test.ts, verify-schema.test.ts, queue.test.ts, helpers.ts
│  │  └─ src/
│  │     ├─ client.ts            [built P0] getPool, getDb, withAdmin, withUser, close
│  │     ├─ env.ts               [built P0] loadEnv (walks up), requireDatabaseUrl, isLocalUrl
│  │     ├─ migrate.ts           [built P0] CLI wrapper around migrator.ts
│  │     ├─ migrator.ts          [built P0] checksum runner (no pooler refusal yet)
│  │     ├─ reset.ts             [built P0] drops graphile_worker and public; refuses non-local URLs
│  │     ├─ seed.ts             [partial P0] stub: logs "nothing to seed yet"
│  │     ├─ verify-schema.ts, verify-schema-lib.ts   [built P0] tables, columns, nullability
│  │     ├─ ingest/persist.ts     [built P1, uncommitted] recordSourceSuccess (one-transaction board commit), recordSourceFailure, startRun, finalizeRun (soft-close), closeBoard, upsertCompanyBoard
│  │     ├─ schema/ingest.ts      [built P1, uncommitted] companies, company_boards, postings, ingest_runs, ingest_source_runs
│  │     ├─ queue.ts             [built P0] addJob over quickAddJob (owner connection, §2.3)
│  │     ├─ schema/ops.ts        [built P0] worker_heartbeats, feature_flags, rate_limits
│  │     ├─ schema/index.ts      [built P0]
│  │     ├─ verify-rls.ts        [planned P4]
│  │     ├─ verify-auth.ts       [planned P4]
│  │     ├─ auth.ts              [planned P4] scrypt plus opaque sessions
│  │     └─ index.ts            [built P0] public exports
│  ├─ ingest/                     [built P1, uncommitted] @hirelane/ingest. No src/index.ts yet (**Gap**: package.json names it as main and types). Workers import src/run/index and src/connectors/index directly
│  │  ├─ boards.json, boards.candidates.json   [built P1] 119 verified boards (80 greenhouse, 28 ashby, 11 lever) and 154 candidates
│  │  ├─ src/contract.ts          [built P1] RawPosting, Connector, FetchBoardResult, FetchPolicyError, NormalizedPosting
│  │  ├─ src/normalize.ts         [built P1] normalize(), contentHash() (version v1)
│  │  ├─ src/connectors/          [built P1] shared.ts (makeConnector, fixed URLs, token guard), greenhouse.ts, lever.ts, ashby.ts
│  │  ├─ src/run/                 [built P1] run.ts (runIngest, ingestBoard, seedBoards), policy.ts (createPolicyFetch: 30 s timeout, 20 MB cap, host spacing), retry.ts, fixtures.ts (fixture transport), boards.ts, args.ts
│  │  ├─ src/record/              [built P1] recordBoards (1 req/s per host; writes fixtures, boards.json, manifest), limiter.ts, fetch.ts, mini.ts (deriveMini), trim.ts, cli.ts (pnpm ingest:record)
│  │  ├─ src/cli.ts               [built P1] pnpm ingest:run (fixture or live)
│  │  └─ test/                    [built P1] 12 files, 166 tests (passing 2026-10-16)
│  └─ agent/                      [built P2, uncommitted] @hirelane/agent. package.json exports "." and "./llm". Depends on @anthropic-ai/sdk, zod, @hirelane/db. 31 tests in 4 files, passing 2026-10-16
│     ├─ src/index.ts             [built P2] re-exports llm/index.ts
│     ├─ src/llm/                 [built P2, uncommitted] AnthropicProvider (anthropic.ts), FixtureProvider (fixture.ts), NullProvider (null.ts), factory.ts (HIRELANE_LLM_MODE: anthropic | fixture | off), prompt.ts, db-sink.ts (llm_calls metadata only), types.ts (DEFAULT_MODEL claude-opus-5-5). See docs/enrichment.md §5
│     ├─ test/                    [built P2] llm-anthropic, llm-mode, llm-null-fixture, llm-prompt
│     ├─ embeddings/              [planned P2] hash; local [P4]
│     ├─ resume/                  [planned P4] parse (LLM plus section-heuristic fallback)
│     ├─ draft/, approval/, handoff/, tailor/   [planned P5]
│     ├─ mail/                    [planned P6] inbound adapter, mailer, templates
│     └─ submit/                  [planned P9] flagged, isolated entry point
├─ workers/runner/                [built, partial P0] package name @hirelane/runner
│  ├─ src/index.ts                [built P0] graphile-worker bootstrap, concurrency 4, pollInterval 2000
│  ├─ src/tasks/index.ts          [built P0, extended P1] taskList = { heartbeat, ...createIngestTasks() }
│  ├─ src/tasks/ingest.ts         [built P1, uncommitted] ingest:schedule, ingest:source, ingest:finalize; deps injectable (IngestDeps)
│  ├─ test/ingest.tasks.test.ts   [built P1, uncommitted]
│  ├─ src/tasks/heartbeat.ts      [built P0]
│  ├─ test/runner.test.ts         [built P0] heartbeat behaviour, task list, crontab
│  └─ crontab                     [partial P0, extended P1] heartbeat and `7 */6 * * * ingest:schedule`; full schedule in §4.2
├─ apps/web/                      [built P0 to P3, uncommitted] Next 15, React 19, Tailwind v4, :3001. Depends on @hirelane/db and @hirelane/engine
│  ├─ middleware.ts               [built P3] markdown negotiation for /job/{slug} (lib/negotiate.ts). Rewrites to /md/job/{slug}, 404s direct /md/*, adds Vary and a Link alternate to HTML
│  ├─ app/layout.tsx, wordmark.tsx, source-badge.tsx, globals.css, icon.svg, fonts/   [built P0] shell, wordmark, ATS source marks, Overpass
│  ├─ app/                        [built P3] pages:
│  │  ├─ page.tsx                 `/` home
│  │  ├─ jobs/page.tsx            `/jobs` ledger with URL-state filters; only the bare ledger is indexable
│  │  ├─ job/[slug]/page.tsx      `/job/{slug}` HTML job page (open or closed)
│  │  ├─ companies/page.tsx, company/[slug]/page.tsx   `/companies`, `/company/{slug}`
│  │  ├─ lists/page.tsx, lists/[slug]/page.tsx         `/lists`, `/lists/{slug}` (ISR, no paging)
│  │  ├─ how-it-works/, compare/, about/, status/      product pages
│  │  ├─ api-docs/page.tsx        `/api-docs`, rendered from buildOpenApi()
│  │  └─ ops/ingest/page.tsx, ops/session/route.ts    `/ops/ingest`, guarded by the ops token cookie (lib/ops-auth.ts)
│  ├─ app/api/health/route.ts     [built P0] `/api/health`
│  ├─ app/api/public/             [built P3] the public JSON API
│  │  ├─ _lib/handlers.ts         createJobsHandler, createJobDetailHandler: rate-limit gate, strict parsing, cachedJson, 500 on error. Deps are injectable for tests
│  │  ├─ _lib/http.ts             CORS_HEADERS, errorResponse, weakEtag, etagMatches, cachedJson, optionsResponse
│  │  ├─ _lib/detail.ts           getPublicJobDetail: one job by slug with requirements, salary trace and sources
│  │  ├─ jobs/route.ts            GET, OPTIONS: `/api/public/jobs`
│  │  └─ jobs/[slug]/route.ts     GET, OPTIONS: `/api/public/jobs/{slug}`
│  ├─ app/openapi.json/route.ts   [built P3] OpenAPI 3.1 document (force-static, revalidate 3600; APP_ORIGIN is read at build time)
│  ├─ app/llms.txt/route.ts       [built P3] llms.txt body (1 h cache)
│  ├─ app/robots.txt/route.ts     [built P3] robots.txt
│  ├─ app/sitemap.xml/route.ts    [built P3] sitemap index
│  ├─ app/sitemaps/               [built P3] jobs/[file] (chunks of 50,000), companies.xml, lists.xml
│  ├─ app/md/job/[slug]/route.ts  [built P3] markdown for one job; internal, reached only through the middleware rewrite
│  ├─ lib/queries/jobs.ts         [built P3] the board query: filter, total, page and facets in one parameterised statement; appOrigin(); toPublicJob()
│  ├─ lib/queries.ts, lib/session.ts   [stub P0] getFreshestJobs and getSession are placeholders
│  ├─ lib/public-api-params.ts    [built P3] API_PARAM_ORDER, parseStrict (400 on bad values), serializeApi (canonical links)
│  ├─ lib/public-api-schema.ts    [built P3] schemas derived from lib/contracts/jobs.schema.json (JobDetail merged, Error codes enumerated)
│  ├─ lib/contracts/jobs.schema.json   [built P3] committed JSON Schema contract for the list envelope and job detail
│  ├─ lib/openapi.ts              [built P3] buildOpenApi(origin): paths, parameters, responses, components
│  ├─ lib/llms.ts                 [built P3] llmsTxt(origin) and PARAM_DOCS
│  ├─ lib/negotiate.ts           [built P3] prefersMarkdown, routeJobPath (q-values, most specific range wins)
│  ├─ lib/rate-limit.ts          [built P3] checkRateLimit (fixed window in rate_limits), clientIp (TRUST_PROXY_HOPS)
│  ├─ lib/sitemap.ts, sitemap-http.ts, robots.ts   [built P3] sitemap builders and readers, the route wrapper (503 without error text), robots body
│  ├─ lib/lists.ts, lists-data.ts [built P3] SEO list registry (publish at 20 or more open jobs) and its database reads
│  ├─ lib/job-data.ts, job-view.ts, job-markdown.ts, job-markdown-data.ts, markdown.ts, pay.ts, format.ts   [built P1 to P3] job page data and view rules, markdown rendering and HTML-to-markdown, pay display and trace, formatting
│  ├─ lib/ledger.ts               [built P3] page size and page parsing for the ledger
│  ├─ lib/ingest-data.ts, ops-auth.ts   [built P1] ops reads and the ops token check (timing-safe)
│  ├─ tests/                      [built P0 to P3] 29 Vitest files. DB-backed suites use TEST_DATABASE_URL and helpers/public-api-seed.ts. llms-openapi-sync.test.ts keeps llms.txt parameter names equal to /openapi.json
│  ├─ playwright.config.ts        [partial P0] webServer `pnpm dev`, baseURL :3001, desktop and mobile projects. No globalSetup running db:fresh yet
│  └─ public/brand/               [built P0] hirelane-mark.svg, hirelane-wordmark.svg
├─ storage/                       [planned P4] gitignored; encrypted blobs (BlobStore local disk)
├─ .mail/                         [planned P6] gitignored; dev mail outbox
└─ .cache/                        [planned P4] gitignored; local embedding models
```

---

## 7. Open items

1. **FORCE RLS versus `withAdmin` on a non-superuser owner** (§3.1). Pick option 1, 2 or 3 before migration `0006_profiles_resumes.sql` (Phase 4). Until then `verify-rls` must also run as a non-superuser owner.
2. **`@hirelane/db` depends on `graphile-worker`.** Enqueueing uses the owner connection after commit (§2.3). PLAN §5.2's "may import" column should be amended to match. Not yet amended.
3. **Drizzle pgvector type.** Confirm `vector({ dimensions: 384 })` in the first phase that adds a vector column, or fall back to `customType`. Still open.
4. **Unnamed secrets** for inbound mail, the mailer, Razorpay and Stripe. Name them in the phase that introduces each one, then add them to §5 and `.env.example` as blanks. Still open.
5. **Engine clock and randomness ban.** Choose the enforcement mechanism (lint rule or guard script) in Phase 2. Still open.
6. **Owner membership in `hirelane_app`.** Add `GRANT hirelane_app TO current_user` (tolerating `duplicate_object` and `invalid_grant_operation`) in a migration, so `withUser` works with a non-superuser owner. Not yet done. Needed before any user-scoped query runs outside a superuser (Phase 4 at the latest).
7. **Direct-connection TLS and pooler refusal.** Apply the TLS rule to the graphile-worker connection and to `addJob`, and refuse a `-pooler.` host in `migrate`. Not yet done.
8. **Worker time zone and concurrency.** Set `TZ=UTC` for the worker, and raise `concurrency` to 8 when ingest lands. Not yet done.
9. **`verify-schema` coverage.** Add type and `pg_indexes` checks, as §3 requires. Not yet done.
10. **Missing tooling referenced by the docs.** `pnpm setup:keys` (referenced by `.env.example`) does not exist. Either add it in Phase 4 with the master key, or remove the reference.
11. **Phase 0 is not yet committed.** As of 2026-10-16 the Phase 0 files are untracked in git (only `CLAUDE.md`, `PLAN.md` and `docs/recon/*` are tracked, and `.gitignore` has uncommitted edits). The acceptance checklist in PLAN.md Phase 0 has not been ticked.
