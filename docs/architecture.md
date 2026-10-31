# Hirelane architecture

> Status: Phase 0 (task 0.2, architect), first reconciled against the working tree on 2026-10-16. Drift pass against the code on 2026-10-28: engine, ingest, agent, runner tasks, web landing v3, waitlist, autopilot stats, migrations 0001 to 0006 and the FORCE RLS decision are updated. The public board and API (Phase 3) are in the codemap; their contract is in `docs/public-api.md`. Drift pass on 2026-11-01: §4 (crontab and task catalogue), §5 (environment rows) and §6 (codemap) now cover picks and paste, notifications, the ops CLI, migrations 0014 to 0016 and the apply address.
> Each section says whether it describes what is **built** or what is **planned**. Every path in the codemap (§6) is tagged with the phase that creates it. Items still tagged P4 or later are not built.
> PLAN.md §5, §6 and §10 are the source of truth. Where this document goes beyond them, or where the build differs from them, it says so under **Gap** or **Note**.
> `doc-updater` keeps this codemap current (task 0.11).

---

## 1. Conventions inherited from solum

| Area | Rule | Status |
|---|---|---|
| Workspace | pnpm `9.12.0` (`packageManager`), `engines.node >= 20`, globs `packages/*`, `apps/*`, `workers/*` | Built (`package.json`, `pnpm-workspace.yaml`) |
| Package shape | Scope `@hirelane/*`, `"private": true`, `"type": "module"`, `"main"` and `"types"` both `./src/index.ts`. Consumed from source, no build step. Internal deps use `workspace:*` | Built for `db`, `engine`, `ingest` and `agent`. **Note:** `workers/runner` (named `@hirelane/runner`, not `@hirelane/worker`) has `main` but no `types`, and uses `workspace:^`. `packages/ingest` has `main` and `types` but no `src/index.ts` (see §2.1) |
| Scripts | Package scripts run TypeScript through `vite-node` (`"migrate": "vite-node src/migrate.ts"`). Root scripts delegate with `pnpm --filter @hirelane/<pkg> <script>` | Built |
| TypeScript | `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`. Every package has `typecheck: tsc --noEmit` | Built for `db`, `runner`, `web`, `engine`, `ingest` and `agent`. `engine` has `typecheck: tsc --noEmit` |
| Tests | Vitest for unit tests, Playwright for e2e on `http://localhost:3001` in fixture mode | Vitest is configured as a root `vitest.config.ts` using `projects` (not a `vitest.workspace.ts`). Playwright lives at `apps/web/playwright.config.ts`. **Gap:** its `globalSetup` that runs `db:fresh` is not yet present |
| `.env` discovery | Walks up from `process.cwd()` to find the repo-root env file. Host-provided `DATABASE_URL` skips the walk | Built in `packages/db/src/env.ts` (`loadEnv`), not `client.ts`. It looks for `.env.local` first, then `.env`, up to six levels up. `import.meta.dirname` is not used for this |
| TLS | TLS with `rejectUnauthorized: true` is forced for any `DATABASE_URL` host that is not localhost, whatever `sslmode` says | Built for the `pg` pool (`getPool` in `client.ts`). **Gap:** not applied to the graphile-worker connection (`workers/runner/src/index.ts`) or to `addJob`, which pass the raw URL |
| Pooled endpoints | `migrate` refuses a transaction-mode pooler (a `-pooler.` host). graphile-worker needs a direct connection for LISTEN/NOTIFY | **Gap:** not implemented. `migrate.ts` and `migrator.ts` contain no pooler check, and nothing checks the worker's endpoint |
| Tenant context | `withUser(userId, fn)` runs `BEGIN` → `SET LOCAL ROLE hirelane_app` → `set_config('hirelane.user_id', $1, true)` → `fn` → `COMMIT`. The scope is transaction-local, so a pooled connection cannot leak one user's context into the next request | Built (`client.ts`). **Gap:** see §3.2. The migrations do not yet grant the owner membership in `hirelane_app` |
| Admin context | `withAdmin(fn)` runs as the owner. Only migrations, seed, ingest, ops and system sweeps may use it (PLAN §10) | Built (`client.ts`). Used by `migrate`, `verify-schema`, `reset`, `seed`, the enrich tasks, and `/api/public/stats/autopilot`. **Gap:** no allowlist guard yet (decision in §3.1) |
| Database | Image `pgvector/pgvector:pg16`, not solum's `postgres:16-alpine`, because that image has no pgvector. Container `hirelane-postgres`, port `127.0.0.1:5433:5432`, volume `hirelane-pgdata`, `pg_isready` healthcheck | Built (`docker-compose.yml`). `docker/initdb/01-create-test-db.sql` also creates `hirelane_test` on first start, for `TEST_DATABASE_URL` |

---

## 2. Package dependency rules

### 2.1 Ownership and allowed imports (PLAN §5.2)

| Package | Name | Owns | May import | Must not | Status |
|---|---|---|---|---|---|
| `packages/engine` | `@hirelane/engine` | Salary, skills, requirements, classifiers, dedup keys, match score, autopilot rules, reply and question classifiers. Exports `ENGINE_VERSION`. Every result carries a `Trace` | nothing (zero runtime deps) | Use network, DB, the clock (`now` is injected), or randomness | Built (P2). `package.json` exists (`test`, `typecheck`, `eval`). Used by `apps/web` (role families, places, lists, the autopilot stats route) and `workers/runner` (`enrich-cli.ts` and the enrich tasks). `ENGINE_VERSION` is `'1.0.0'` in `src/version.ts`. **Note:** `src/index.ts` still starts with a leftover placeholder line (`export const x=1`) above the real exports |
| `packages/db` | `@hirelane/db` | `client.ts` (`withAdmin`, `withUser`, `getPool`, `close`), `migrate.ts`, `migrator.ts`, `reset.ts`, `seed.ts`, `verify-schema.ts`, `queue.ts` (`addJob`), Drizzle schema in `src/schema/*.ts`, and the persistence helpers in `src/enrich/` and `src/ingest/` | `pg`, `drizzle-orm`, `graphile-worker` (see §2.3) | Contain business logic | Built (P0 to P2). `verify-rls.ts`, `verify-auth.ts` and `auth.ts` are planned (P4) |
| `packages/ingest` | `@hirelane/ingest` | Connectors (`greenhouse.ts`, `lever.ts`, `ashby.ts`) → `RawPosting`, recorder, `boards.json`, fixtures, persistence and diff, and company logo resolution in `src/company/` | `db` (and `sharp`, `zod`) | Enrichment or LLM calls | Built (P1, P3). Consumed by `workers/runner` only. **Gap:** no `src/index.ts` barrel. The runner deep-imports `src/run/index`, `src/connectors/index`, `src/contract`, `src/company/logo` and `src/company/transport` (see §6 and §7, item 13) |
| `packages/agent` | `@hirelane/agent` | `llm/`, `embeddings/`, resume parsing, drafting, approval state machine, handoff payload and per-ATS capabilities, tailoring, `mail/`, `submit/` (P9, flagged) | `engine`, `db` | Any HTTP call to an ATS application endpoint outside `src/submit/` | Partly built (P2): only `src/llm/*` exists, exported as `.` and `./llm`. Everything else is planned (P2 onward). **Nothing imports `@hirelane/agent` yet**, and `workers/runner` does not depend on it |
| `packages/services` | `@hirelane/services` | The service layer (Amendment B §11): one function per feature, called by server actions and `/api/v1`. Resumes (upload, confirm, download, delete), eligibility, the guided builder, `me`/export, idempotency, the sealing helpers (`seal.ts`, `aad.ts`), the error model and the view types. Built Slice 3, uncommitted. Barrel in `src/index.ts`. Tests in `packages/services/test/` | `db`, `engine`, `vault`, `agent` (rule `services-deps`) | Route handlers or server actions with business logic of their own | Built (Slice 3). The `apps/web` v1 routes and actions call it |
| `workers/runner` | `@hirelane/runner` | graphile-worker bootstrap, tasks, crontab, and the in-process `enrich:run` CLI | all packages | Contain UI | Built, partially (P0 to P2). Registered tasks are listed in §4.3. `company:logo` is coded and tested but not registered |
| `apps/web` | `@hirelane/web` | Pages, server actions, route handlers, `lib/{queries/,session,format}.ts` | `db`, `engine`, `agent` | Import `ingest` or `workers` | Built, P0 to P3, plus the landing v3 home page (`/`), the waitlist and the autopilot stats route. The public board, job, list and company pages, the public API route handlers, markdown negotiation, `llms.txt`, sitemaps and `robots.txt` are part of P3. It depends on `@hirelane/db` (`withAdmin`) and `@hirelane/engine` (role families, places). **Still stubs:** `lib/session.ts` (sessions arrive in P4), and `lib/queries.ts` (`getFreshestJobs`, unused). `lib/queries.ts` sits next to the real `lib/queries/` directory (`jobs.ts`, `landing.ts`), so both exist (§7, item 12) |

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
| `services-deps` | `packages/services/src` | any `packages/*` except `services`, `db`, `engine`, `vault` and `agent`, `apps/`, `workers/` | The shared service layer is called by server actions and `/api/v1`. It may use db, engine, vault and agent, and nothing else. Added Slice 3 |
| `api-v1-thin` | `apps/web/app/api/v1/` | `@hirelane/db`, any other workspace package except `services`, `workers/`, web modules other than `lib/auth` and `lib/http` | Route handlers parse, call `@hirelane/services`, and map results. Added Slice 3 |
| `actions-thin` | `apps/web/app/(app)/**/actions.ts` | any `packages/*` except `services`, `workers/` | Signed-in server actions reach data through `@hirelane/services` or `apps/web/lib` only (Amendment B §11). Added Slice 3 |
| `extractors-worker-only` | anything outside `workers/runner/` | `unpdf`, `pdfjs-dist`, `fflate`, `pdfkit`, `fontkit` | The heavy parsers and renderer stay in the runner, where the extraction sandbox is. Added Slice 3 |

The four Slice 3 rules are checked by `pnpm lint:deps`. Their own tests are in `scripts/test/depcruise-rules.test.ts`.
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
| Schema types | `packages/db/src/schema/*.ts` (Drizzle `pg-core`). It mirrors the SQL and never generates it | Built for `schema/ops.ts`, `ingest.ts`, `jobs.ts`, `llm.ts` and `waitlist.ts` |
| Queries | Drizzle query builder over the `PoolClient` that `withUser` or `withAdmin` hands in, so RLS context and role apply to every Drizzle query. Raw `client.query` stays allowed for SQL Drizzle cannot express (HNSW KNN ordering, `REFRESH MATERIALIZED VIEW CONCURRENTLY`, `set_config`) | `getDb()` exists in `client.ts` but has no callers yet. The heartbeat task uses raw `client.query` |
| Migrations | `packages/db/migrations/NNNN_<name>.sql`, applied in lexical order by `migrate.ts` | Built. `0001` to `0006` exist (list below), including `0004a` and `0004b` |
| Runner | Ported from solum. Creates `schema_migrations(name text pk, checksum text, applied_at timestamptz)`, computes `sha256(file)` (first 16 hex characters) per file, skips files whose checksum matches, **refuses** an applied file whose checksum has changed, applies each new file in its own `BEGIN … COMMIT` and records it, and rolls back with the file name on failure. It refuses a pooled endpoint | Built in `migrator.ts`, except the pooler refusal (**Gap**, see §1) |
| Drizzle Kit | `drizzle-kit push` and `drizzle-kit generate` are **never** used. There is no `drizzle.config.ts` and no `drizzle-kit` dependency | Confirmed absent |
| Drift | `verify-schema.ts` (via `verify-schema-lib.ts`) compares the Drizzle schema with `information_schema` and exits non-zero on a missing or extra table or column, or on a nullability mismatch. It runs in `pnpm verify` | Built for tables, columns and nullability. **Gap:** the ADR also requires type and `pg_indexes` checks. Neither is implemented, so the unique index on `feature_flags` and the HNSW and trigram indexes to come are not covered |
| pgvector | Drizzle `vector({ dimensions: 384 })` from `drizzle-orm/pg-core` `[assumption: confirm in Phase 0; fall back to customType]`. Each embedding row also stores `embedding_model`, and a provider change means a new migration plus the `embed:reindex` task | **Partly confirmed.** A vector column now exists: `jobs.embedding vector(384)` (migration `0004_jobs_enrichment.sql`), mirrored by `vector({ dimensions: 384 })` in `schema/jobs.ts`. The drift check does not compare types, so the match is not verified by tooling (§7, item 3) |
| Roles | Owner (the connection user) owns every object. `hirelane_app NOLOGIN` owns nothing. Migrations `GRANT hirelane_app TO current_user` (tolerating `duplicate_object` and `invalid_grant_operation`, as solum does) so that `SET LOCAL ROLE` works from the owner connection | **Gap:** no migration grants this yet (a search for `GRANT hirelane_app` finds nothing). A local superuser owner does not need it, so Docker hides the gap. A non-superuser owner would fail at `SET LOCAL ROLE`. Add the grant in the next migration |

**Migrations named by the plan:**
- `0001_foundation.sql` (**built**): extensions `vector`, `pg_trgm`, `citext`, `pgcrypto`; role `hirelane_app NOLOGIN` (created idempotently, since roles are cluster-wide); tables `worker_heartbeats` (index `worker_heartbeats_at_idx`), `feature_flags` (unique index on `key, coalesce(user_id, nil uuid)`), `rate_limits` (primary key `(bucket, window_start)`). It also grants `USAGE` on `public` to the app role, `SELECT` on `feature_flags`, and `SELECT, INSERT, UPDATE, DELETE` on `rate_limits`.
- `0002_companies_boards_postings.sql` (**built**, P1): `companies`, `company_boards`, `postings`.
- `0003_ingest_runs.sql` (**built**, P1): `ingest_runs`, `ingest_source_runs`.
- `0004_jobs_enrichment.sql` (**built**, P2): `skills`, `fx_rates`, `jobs` (including `embedding vector(384)`), `job_requirements`.
- `0004a_llm_calls.sql` (**built**, P2): `llm_calls`. Metadata only, with no prompt or completion text.
- `0004b_posting_geo.sql` (**built**, P2): an `ALTER` that adds `postings.geo_countries char(2)[]`. It creates no table.
- `0005_public_board.sql` (**built**, P3): a trigram index on `jobs`, and the materialized view `job_facets`, which has a unique index and `SELECT` granted to `hirelane_app`. It is a view, not a table.
- `0006_waitlist.sql` (**built**, landing): `waitlist`, with a unique index on `lower(email)`, and an `INSERT`-only grant to `hirelane_app`. It holds contact details only.

The P4 auth and profile migrations (planned `users`, `sessions` (revoked from the app role), `email_tokens`, then `profiles`, `work_authorizations`, `answer_bank`, `resumes`, all with RLS) take the next free numbers after `0006`. They are assigned in P4. The names `0005_auth.sql` and `0006_profiles_resumes.sql` used earlier in this document are already taken.

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

Several Hirelane `withAdmin` paths read across users and would silently return nothing on such a host: `application:commit-expired`, `retention:purge`, `ops:freshness`, `/ops/*`, export and delete. **Decided 2026-10-28** (`docs/design/hld-lld-core-loop.md`, conflict 1). Drop FORCE and keep ENABLE. `hirelane_app` owns nothing, so ordinary RLS applies to it. Cross-user `withAdmin` paths are limited by a `withadmin-allowlist` guard, either a guard script or a dependency-cruiser rule on the `withAdmin` import, so user routes stay on `withUser`. `verify-rls` runs as a **non-superuser** owner, so the failure cannot hide behind Docker's superuser.

**Not implemented yet** (checked 2026-10-28). No migration enables RLS. `withAdmin` in `client.ts` has no allowlist. `verify-rls.ts` does not exist, and `db:verify-rls` is still a stub that echoes "not implemented until Phase 4". The guard and `verify-rls` are due with the first user-owned table in P4 (§7, item 1).

The options considered before the decision were:

1. Grant the owner `BYPASSRLS` explicitly. FORCE stays, and admin intent is explicit.
2. Keep FORCE and run every cross-user sweep as per-user `withUser` iterations. This exercises RLS more, but is slower and awkward for aggregates.
3. Follow solum and drop FORCE. The app role owns nothing, so ordinary RLS already applies to it. **This is the option chosen.**

The "No user-owned table exists yet" point above still holds. Nothing is at risk today.

**Slice 3 addition (2026-10-29).** `apps/web/lib/auth/erasure.ts` runs one `SELECT` of the deleting user's own `blob_keys` through `withAdmin`, so account erasure can delete the stored files before the cascade. It is one exact file on the `withadmin-guard` allowlist. **Owner sign-off is pending.** The alternative is a column grant on `resumes(user_id, blob_key)` plus an RLS policy for `hirelane_auth`, which adds schema surface. See `docs/auth.md` §7.

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
| "8 global" for `ingest:source` | Worker `concurrency` covers all tasks in a process. Ingest's global cap of 8 is enforced by running ingest at worker `concurrency: 8`. If other task classes need a different cap, they get a separate runner process `[assumption: one process in Phase 0–1]` | **Open:** `workers/runner/src/index.ts` still runs at `concurrency: 4` (line 13), so ingest's cap of 8 is not applied yet (§7, item 8) |
| "1 per host" | A named `queueName` on `ingest:source` (planned as `host:<hostname>` here, but the code uses `ingest-{ats}`, one queue per ATS) and on `company:logo` (planned, not registered). graphile-worker runs jobs in a named queue strictly one at a time. The **1 request per second** limit inside a task is a separate in-process limiter in `@hirelane/ingest`, because queue serialisation alone does not throttle. Named queues carry a throughput cost, so they are used only where serialisation is required. `enrich:` facets refresh uses a `facets` queue | Built for `ingest:source` and `facets:refresh` (P1, P2). `company:logo` planned (P3) |
| Singletons | A fixed `jobKey` (for example `ops:freshness`). Cron items also rely on the crontab's own once-per-tick guarantee. `facets:refresh` uses `jobKey` with `jobKeyMode: 'preserve_run_at'` | Built for `facets:refresh`. Other singletons planned |
| Replace semantics | `jobKeyMode: 'replace'` for `match:user-full`, so the latest resume or profile change wins | Planned (P4) |
| Retries | graphile-worker exponential backoff (`maxAttempts` per task). Ingest's HTTP retries (3, honouring `Retry-After` on a 429) happen inside the task | `maxAttempts` is set on `ingest:source` (5), `ingest:finalize` (5), `enrich:company` (3) and `facets:refresh` (3). The HTTP retry layer is `packages/ingest/src/run/retry.ts` |
| Time zone | The worker runs with `TZ=UTC`, so `03:30` means 03:30 UTC unambiguously | **Gap:** neither the `worker` script, the runner code nor `.env.example` sets `TZ`. Add `TZ=UTC` to the worker's environment |
| DB access in tasks | `withAdmin` for ingest and ops. `withUser(userId)` for anything per-user, so RLS stays exercised (PLAN §10) | `heartbeat` uses graphile-worker's own `helpers.withPgClient`, not `withAdmin`. That is acceptable for a system task that writes one table, but it is not the documented pattern. The enrich tasks use `withAdmin` (`workers/runner/src/tasks/enrich.ts`) |

### 4.2 Crontab (`workers/runner/crontab`)

The intended schedule (PLAN §5.5) is:

```
7 */6 * * *   ingest:schedule
37 */6 * * *  enrich:schedule
*/15 * * * *  ops:freshness
30 3 * * *    retention:purge
* * * * *     application:commit-expired
* * * * *     heartbeat
0 4 1 * *     company:logo          # monthly refresh; exact slot [assumption]
13 * * * *    resume:purge-sweep    # Slice 3: hourly backstop for the 24 h resume purge
43 * * * *    resume:stuck-sweep    # Slice 3: hourly; re-queues stuck uploads, revives stuck extracts
27 * * * *    idempotency:sweep     # Slice 3: deletes idempotency keys older than 24 h
```

**Built today** (`workers/runner/crontab`): `heartbeat` (`* * * * *`), `ingest:schedule` (`7 */6 * * *`, Phase 1) and `enrich:schedule` (`37 */6 * * *`, Phase 2, 30 minutes after ingest). The `company:logo` line above is not in the crontab yet. The task is registered (§4.3), but no schedule entry exists. The Slice 3 lines (`resume:purge-sweep`, `resume:stuck-sweep`, `idempotency:sweep`) are in the crontab, and `resume:purge-sweep`, `resume:stuck-sweep` and `idempotency:sweep` are registered in `tasks/resume-purge.ts`, `tasks/resume-stuck.ts`. The other entries are added by the phase that creates their task. The ingest flow is described in `docs/ingest.md`.

**Slice 4 and later, in the crontab (uncommitted, checked 2026-11-01):** `20 2 * * *` `campus:stats`, `*/5 * * * *` `apply:sweep`, `*/5 * * * *` `inbound:scan` (the fixture mailbox; a missing folder is not an error), `10 3 * * *` `housekeeping:sweep` and `*/10 * * * *` `notify:sweep`. Each is registered in `tasks/index.ts`, and each has a row in §4.3.

### 4.3 Task catalogue (PLAN §5.5, condensed)

| Task | Trigger | Key / concurrency | Context | Phase | Status |
|---|---|---|---|---|---|
| `heartbeat` | every minute | singleton | system | 0 | Built. Inserts into `worker_heartbeats` and prunes rows older than one day |
| `ingest:schedule` | cron `7 */6 * * *` | singleton | admin | 1 | Built (uncommitted). Skips when a run is `running` and started within 2 hours. Inserts `ingest_runs`, enqueues one `ingest:source` per verified board and one `ingest:finalize`. See `docs/ingest.md` §3 |
| `ingest:source` | schedule | `ingest:source:{runId}:{boardId}` key; queue `ingest-{ats}` (one per ATS host); `maxAttempts 5` | admin | 1 | Built (uncommitted). Fetches one board through `@hirelane/ingest` and commits it in one transaction. Failed fetches are recorded, not thrown. Worker concurrency is 4 (**Gap**: ingest expects 8) |
| `ingest:finalize` | last source done, or a 45-minute timeout | per run; re-queues every 15 s | admin | 1 | Built (uncommitted). Records boards that never committed as failed, soft-closes postings with `missed_runs >= 2`, and writes run totals. See `docs/ingest.md` §4 |
| `enrich:schedule` | cron `37 */6 * * *` | singleton | admin | 2 | Built. Runs the lifecycle sync (closures and reopens reach `jobs` here), enqueues `facets:refresh` when anything changed, and fans out one `enrich:company` per company with pending postings. A posting is selected only when its content hash or `ENRICH_VERSION` changed |
| `enrich:company` | enqueued by `enrich:schedule` (`enrich:run` calls the same code in-process, without the queue) | key `enrich:company:{companyId}`; `maxAttempts 3` | admin | 2 | Built. Enriches one company's postings, then enqueues `facets:refresh` when anything was created or enriched |
| `enrich:posting` | was planned as new or changed posting; `enrich_version` bump | per posting | admin | 2 | Registered in `tasks/enrich.ts`, but no code enqueues it yet. `enrich:company` is the batch path |
| `facets:refresh` | enqueued by the enrich tasks, delayed 60 s | `jobKey facets:refresh`; queue `facets`; `maxAttempts 3` | admin | 2 | Built. `REFRESH MATERIALIZED VIEW CONCURRENTLY job_facets` |
| `company:logo` | new company, or monthly | per company; SSRF-guarded | admin | 3 | Coded and tested in `tasks/company.ts`, with fixture and live modes through `@hirelane/ingest/src/company`. Registered in `tasks/index.ts` (checked 2026-11-01). **No crontab entry yet**, so it runs only when queued by hand |
| `embed:job` / `embed:resume` / `embed:reindex` | enrich, parse, provider change | per entity | admin / user | 2–4 | Planned |
| `match:user-full` | resume or profile change | per user (replace) | user | 4 | Planned |
| `match:user-delta` | ingest finalize | per user | user | 4 | Planned |
| `resume:extract` | upload, builder render, stuck sweep | `jobKey resume:extract:{id}`; id-only payload | user | 3 | Built (Slice 3, uncommitted). `tasks/resume-extract.ts` runs `resume/pipeline.ts`: the sandboxed extraction (`extractInThread`), masking, health, education. Writes the extractor-owned columns as the owner role. See `docs/resume.md` §0 |
| `agent:parse-resume` | upload | per resume | user | 4 | Planned. **Superseded for the deterministic parse:** Slice 3 parses with the engine inside `resume:extract`. An LLM parse, if added, would be a separate task |
| `agent:draft` | apply click, or autopilot | per application | user | 5 | Planned |
| `resume:render` | `finishBuilder` (Slice 3 builder) | per draft; id-only payload; `jobKey` per resume | user | 3 | Built (Slice 3, uncommitted). `tasks/resume-render.ts`: pdfkit, one page, then queues `resume:extract`. The tailoring render for Phase 5 (Playwright PDF) is still planned |
| `resume:purge` | delete; extract (replacing an Aadhaar or PAN original) | `jobKey resume:purge:{id}` | user | 3 | Built (Slice 3). Deletes every blob of the root and its versions first, then nulls `parsed_enc`, `label`, `skills`, `file_hmac`, `blob_key` and sets `purged_at` (0010b). Rows are kept, so the audit trail survives. `tasks/resume-purge.ts` |
| `resume:purge-sweep` | cron `13 * * * *` | singleton | user (per resume) | 3 | Built (Slice 3). Purges rows with `purge_after` passed, and rows deleted 23 h ago or more, so the 24 h bound holds after an hourly gap. Soft-deletes superseded Aadhaar, VID or PAN originals |
| `resume:stuck-sweep` | cron `43 * * * *` | singleton | admin | 3 | Built (Slice 3). Re-queues `resume:extract` for rows in `uploaded` for more than 10 minutes, and resets `extracting` rows older than 5 minutes. `tasks/resume-stuck.ts` |
| `idempotency:sweep` | cron `27 * * * *` | singleton | admin | 3 | Built (Slice 3). Deletes `idempotency_keys` older than 24 h. `tasks/resume-stuck.ts` |
| `campus:stats` | cron `20 2 * * *` | singleton | admin | 4 | Built (Slice 4, uncommitted). Applies the roster, counts the cohorts, evaluates drive verdicts and writes the k-gated snapshot. `tasks/campus-stats.ts`. See `docs/campus.md` |
| `apply:submit` | enqueued by `swipeRight`, and by `apply:sweep` | `jobKey apply:submit:<id>`; per application | user | 5 | Built (Slice 4, uncommitted, fixture only). The executor (`packages/agent/src/submit/`) behind every gate in `docs/apply.md` §3. `tasks/apply-submit.ts` |
| `apply:sweep` | cron `*/5 * * * *` | singleton | admin | 5 | Built (Slice 4, uncommitted). Re-queues lost `ready` submits, fails `submitting` rows older than 15 minutes. `tasks/apply-submit.ts`, `apply-common.ts` |
| `inbound:scan` | cron `*/5 * * * *` | singleton | admin | 5 | Built (Slice 4, uncommitted). Reads `*.eml` from `HIRELANE_MAIL_INBOX` (a fixture mailbox; no live transport). `tasks/inbound-scan.ts`. See `docs/apply.md` §8 |
| `housekeeping:sweep` | cron `10 3 * * *` | singleton | admin | 8 | Built (uncommitted, 2026-11-01). Deletes expired or consumed `otp_challenges`, `rate_limits` older than 2 days and `join_attempts` older than 30 days. `tasks/housekeeping.ts` |
| `notify:sweep` | cron `*/10 * * * *` | singleton | admin | 6 | Built (uncommitted, 2026-11-01). New-drive and closes-tomorrow rows, then the email. Needs a production transport. `tasks/notify-sweep.ts`. See `docs/notifications.md` |
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
| `APP_ORIGIN` | `http://localhost:3001` `[assumption]` | web public job URLs (`lib/queries/jobs.ts`), ingest recorder (UA `HirelaneBot/0.1 (+APP_ORIGIN/contact)`) | no | 1 | Not yet in `.env.example` (checked 2026-10-28). `openapi.json` reads it at build time. Auth does not use it; auth reads `HIRELANE_APP_ORIGIN` |
| `HIRELANE_INGEST_MODE` | `fixture` | ingest, worker | no | 1 | In `.env.example`. `fixture` reads the gzipped fixtures; `live` calls the ATS APIs. Read by code. `packages/ingest/src/run/args.ts` falls back to `fixture`, and the runner treats any value other than `live` as `fixture` |
| `HIRELANE_LOGO_DIR` | none | runner (`company:logo`) | no | 3 | Read by code. Not in `.env.example` |
| `TRUST_PROXY_HOPS` | none | web (`lib/rate-limit.ts`, `clientIp`) | no | 3 | In `.env.example`. Sets how many proxy hops are trusted when reading the client IP |
| `TRUST_X_REAL_IP` | unset | web (`lib/rate-limit.ts`, `clientIp`) | no | 2 | Opt-in. `x-real-ip` is trusted only when this is `1`. Set it only behind an edge that overwrites the header. Not in `.env.example` |
| `HIRELANE_APP_ORIGIN` | `http://localhost:3001` for OIDC redirects; the `Host` header is the CSRF fallback outside production | web auth (`lib/auth/origin.ts`, `google.ts`) | no | 2 | Not in `.env.example`. **Production:** required, and must be public https. Without it in production, every auth mutation is refused and Google sign-in is off |
| `HIRELANE_ACCOUNTS` | unset (then the `accounts` feature flag decides) | web auth (`lib/auth/flags.ts`) | no | 2 | `1` forces accounts on, `0` forces them off. Off gives a 404 on every auth route. Not in `.env.example`. Deferred: no production gate on the override |
| `HIRELANE_GOOGLE_CLIENT_ID` | none | web auth (`lib/auth/google.ts`) | no | 2 | Google OIDC client id. Sign-in stays off unless the client id and secret are both set. Not in `.env.example` |
| `HIRELANE_GOOGLE_CLIENT_SECRET` | none | web auth (`lib/auth/google.ts`) | **yes** | 2 | Google OIDC client secret. Not in `.env.example` |
| `HIRELANE_OIDC_ISSUER` | `https://accounts.google.com` | web auth (`lib/auth/google.ts`) | no | 2 | Issuer override. In production it must be a public https URL |
| `LINKEDIN_CLIENT_ID` | none | web auth (`lib/auth/linkedin.ts`) | no | 2 (Slice 3 docs) | Sign in with LinkedIn (OIDC). Both client values must be set, or the button is hidden and the routes answer 503. In `.env.example` |
| `LINKEDIN_CLIENT_SECRET` | none | web auth (`lib/auth/linkedin.ts`) | **yes** | 2 (Slice 3 docs) | LinkedIn client secret. Same rule as the id. In `.env.example`, blank |
| `HIRELANE_LINKEDIN_ISSUER` | `https://www.linkedin.com/oauth` | web auth (`lib/auth/linkedin.ts`) | no | 2 (Slice 3 docs) | Issuer override. In production it must be a public https URL, or LinkedIn sign-in is off. Not in `.env.example` |
| `HIRELANE_INSECURE_DEV_COOKIE` | unset | web auth (`lib/auth/cookies.ts`) | no | 2 | `1` uses unprefixed, non-Secure cookie names for dev browsers that drop `__Host-` cookies. Ignored when `NODE_ENV` is `production` |
| `HIRELANE_MAIL_OUTBOX` | `<repo>/.mail/outbox` | agent `mail/file-outbox.ts` | no | 2 | Directory for the file outbox (one `.eml` per message). The only mail transport so far. Not in `.env.example` |
| `HIRELANE_OPS_TOKEN` | none | web `/ops/*` | **yes** | 1 | In `.env.example`, blank. Gates ops until admin roles land in Phase 4 |
| `HIRELANE_LLM_MODE` | unset | agent (`src/llm/factory.ts`, `resolveLlmMode`) | no | 2 | In `.env.example`. Code reads `anthropic` or `fixture`. Unset resolves to `anthropic` when `ANTHROPIC_API_KEY` is set, otherwise `off`. An explicit `anthropic` without a key degrades to `off`. Any other value resolves to `off`. There is no `auto` or `live` value in the code |
| `ANTHROPIC_API_KEY` | none | agent `AnthropicProvider` | **yes** | 2 | In `.env.example`, blank. When absent, `auto` resolves to `fixture` |
| `HIRELANE_MODEL_DRAFT` | `claude-sonnet-5-5` | agent | no | 4 | In `.env.example` |
| `HIRELANE_MODEL_BULK` | `claude-haiku-5-5` | agent | no | 2 | In `.env.example`. Extraction and classification fallback |
| `HIRELANE_EMBEDDINGS` | `hash` | agent, worker | no | 2 | In `.env.example`. `hash` (CI) or `local` (cached in `.cache/models`) |
| `HIRELANE_MASTER_KEY` | none (dev key from `pnpm setup:keys`) | agent and db encryption (AES-256-GCM envelope) | **yes** | 4 | Closed 2026-10-29: the root `package.json` has `setup:keys`, which runs `packages/vault/src/setup-keys.ts`. The same key also feeds the auth HMAC subkeys (OTP, address, IP, signed cookies). Never committed. Rotation re-wraps the data keys (Phase 8) |
| `HIRELANE_REPLY_DOMAIN` | none | none | no | 5 | **Removed from `.env.example` (2026-11-01).** No code path reads it. The apply address uses `HIRELANE_APPLY_DOMAIN` and the tag `handle+reply_handle@domain` (`docs/apply.md` §7) |
| Inbound-mail webhook HMAC secret | `[assumption: name TBD]` | web `/api/webhooks/inbound-email` | **yes** | 6 | HMAC-SHA256 over timestamp + body, ±5 minutes. Not yet named (§7, item 4) |
| Real mail transport config | `[assumption: name TBD]` | agent `mail/` | **yes** | 6 | Not chosen. Slice 2 ships the file outbox only (`HIRELANE_MAIL_OUTBOX`) |
| Razorpay key and webhook secret | `[assumption: name TBD]` | web billing, `billing:process-event` | **yes** | 7 | Provider `fake` in dev. Not yet named |
| Stripe key and webhook secret | `[assumption: name TBD]` | web billing, `billing:process-event` | **yes** | 7 | Provider `fake` in dev. Not yet named |
| `HIRELANE_FAULTS` | empty | ingest (test only) | no | 8 | In `.env.example`, blank. For example `board:500:<token>` |
| `HIRELANE_ENABLE_SUBMIT` | none | none | no | 9 | **Removed from `.env.example` (2026-11-01).** CI (`.github/workflows/verify.yml`) still sets it to `0`, and no code path reads it. Auto-apply is governed by `HIRELANE_AUTO_APPLY` (below) and the gates in `docs/apply.md` §3 |
| `HIRELANE_AUTO_APPLY` | unset: `off` in production, `fixture` elsewhere | agent `apply-mode.ts`, services swipe, runner | no | 5 | `off`, `fixture` or `live` (`live` behaves as `fixture`). Any other value is `off`. Startup needs `HIRELANE_APPLY_DOMAIN` when it is not `off` (`docs/apply.md` §1). In `.env.example`, blank |
| `HIRELANE_APPLY_DOMAIN` | `apply.hirelane.localhost` | agent (`assertApplyDomain`), services (apply address), runner | no | 5 | Domain of every student's apply address. Must be a real domain in production. Addresses are permanent (`docs/apply.md` §7) |
| `HIRELANE_MAIL_AUTHSERV_ID` | none | agent (`apply-mode.ts`), runner `inbound-scan` | no | 5 | Authserv-id of our receiving MTA. Required in production, and not a localhost name. The MTA must strip inbound `Authentication-Results` that carry it (`docs/apply.md` §8) |
| `HIRELANE_MAIL_INBOX` | `<repo>/.mail/inbox` | runner `inbound-scan` | no | 5 | Folder of `*.eml` for the fixture mailbox |
| `HIRELANE_STORAGE_DIR` | `<workspace root>/storage` outside production | vault `blob.ts` (web and runner) | no | 3 | In production it must be an absolute path, or startup fails. Web and runner must point at the same folder (`localBlobStoreFromEnv`). In `.env.example`, blank |
| `HIRELANE_OPS_ACTOR` | the OS user name | `pnpm ops` | no | 8 | Recorded on every `ops_audit` row (`docs/ops.md` §1) |
| `HIRELANE_OPS_ALLOW_REMOTE` | unset | `pnpm ops` | no | 8 | Set to `1` to run ops against a database that is not local (`docs/ops.md` §1) |
| `TZ` | `UTC` | worker | no | 0 | **Gap (open, checked 2026-10-28):** not set in `workers/runner`, `package.json` or `.env.example` (see §4.1) |

`ENGINE_VERSION` is a code constant exported by `@hirelane/engine`, not an environment variable. It is `'1.0.0'` in `packages/engine/src/version.ts`.

---

## 6. Codemap

Status key: **[built]** exists and is wired; **[partial]** exists but is a stub or lacks part of its described behaviour; **[planned Pn]** does not exist yet.

```
hirelane/
├─ package.json                  [built P0] pnpm@9.12.0, node>=22.18. Scripts: dev, worker, test, test:scripts, e2e, typecheck,
│                                           lint:deps, brand-guard, no-submit-guard, verify, db:{up,down,migrate,seed,reset,fresh,
│                                           verify-schema}, enrich:run. db:verify-rls and db:verify-auth are built (verify, 2026-10-29). agent:eval is a stub
│                                           that echoes "not implemented until P4". ingest:run, ingest:record, engine:eval, enrich:run, report:coverage
│                                           and bench:board are wired to scripts
├─ pnpm-workspace.yaml            [built P0] packages/*, apps/*, workers/*
├─ .nvmrc                        [built, 2026-10-29] Node 22.18, matching `engines`
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
│  ├─ resume.md                   [built Slice 1, uncommitted] resume pipeline: extract, sensitive, sections, health
│  ├─ eligibility.md              [built Slice 1, uncommitted] criterion grammar, unknown semantics, CGPA rule
│  ├─ auth.md                     [built Slice 2, uncommitted] Google and email code, sessions, 18+ gate, accounts flag, delete. The UI pages are not built
│  ├─ public-api.md               [built P3, uncommitted] public JSON API, markdown negotiation, llms.txt, sitemaps, CORS, ETag, rate limits. §14: the signed-in v1 API (Slices 3 and 4, and §14.9 picks and paste, 2026-11-01)
│  ├─ answers.md                 [built Slice 4, uncommitted, 2026-10-31] application answers without an LLM: classifier, the 23 keys, evidence rule, eval gate. See the engine line below
│  ├─ apply.md                    [built Slice 4, uncommitted, updated 2026-11-01] right swipe = applied: fixture-only executor, undo window, states, cap, consent, receipts, employer mail, open-before-pilot and closed lists
│  ├─ picks.md                    [built, uncommitted, 2026-11-01] daily picks (GET /api/v1/picks, pure ranking), paste a job (POST /api/v1/paste), the picks eval
│  ├─ notifications.md            [built, uncommitted, 2026-11-01] Home rows and email for four kinds, the sweep, the unsubscribe page; what is not wired
│  ├─ ops.md                      [built, uncommitted, 2026-11-01] `pnpm ops` operator commands, the audit rows and the environment they need
│  ├─ campus.md                   [built Slice 4, uncommitted, updated 2026-11-01] campus joins, share levels, k = 10 numbers, roster staging and preview, drive lifecycle (draft, announce, close), drive caps and differencing, staff lifecycle
│  ├─ recon/                      [built] Shortlist teardown notes and text (reference only; shots/ and *-text.md are gitignored)
│  ├─ screens/                    [built] phase-0 to phase-3 screenshots (desktop and mobile), committed per phase
│  └─ privacy-model.md            [planned P4]
├─ scripts/
│  ├─ brand-guard.ts              [built P0] self-tests in scripts/test/brand-guard.test.ts
│  ├─ no-submit-guard.ts          [built P0] self-tests in scripts/test/no-submit-guard.test.ts
│  └─ ops/main.ts, deps.ts        [built, uncommitted, 2026-11-01] `pnpm ops`: the entry point, the actor, the keyed hashes and the remote-database guard. Tests in scripts/test/ops-deps.test.ts. See docs/ops.md
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
│  ├─ engine/                     [built P2, uncommitted] @hirelane/engine. Pure and deterministic, zero runtime deps. package.json (test, typecheck, eval scripts), tsconfig, vitest config. ENGINE_VERSION '1.0.0' in src/version.ts, ENRICH_VERSION 1, DOC_FORMAT_VERSION 1. 1,070 engine tests (verify, 2026-10-29), up from 675 in P2. Slice 1 adds `src/resume/` and `src/eligibility/` (see `docs/resume.md`, `docs/eligibility.md`). See docs/enrichment.md
│  │  ├─ src/index.ts              [built P2] public exports. The old `export const x=1` placeholder is gone (checked 2026-10-29). Slice 1 exports sit under the `campus` heading
│  │  ├─ src/{salary,fx,currency,requirements,skills,places,text,trace,dedup,errors,types,version}.ts   [built P2, uncommitted]
│  │  ├─ src/classify/            [built P2] level, workplace, employment, roleFamily, visa; index.ts re-exports
│  │  ├─ src/internal/tracer.ts   [built P2] evidence helper shared by classifiers and dedup
│  │  ├─ src/answers/             [built Slice 4, uncommitted, 2026-10-31] classify.ts (rules, traps first), answer.ts (`answerFrom`, `answerQuestion`), types.ts (23 keys). No LLM. See docs/answers.md
│  │  ├─ src/{match,autopilot,replies,questions}/   [planned; not in Phase 2]
│  │  ├─ data/                    [built P2] skills.json (1,182 skills), role-families.json, salary-bounds.json, fx_rates.json (illustrative, as of 2026-10-15), places.json
│  │  ├─ scripts/{eval,score}.ts  [built P2] `pnpm engine:eval`; thresholds in score.ts. Corpora in test/corpus/. `scripts/evals/{education,eligibility,sensitive}.ts` are the Slice 1 gates, and `cgpa-rules`, `answers` and `layout` were added 2026-10-31
│  │  └─ test/                    [built P2] one file per module plus corpus.test.ts and the three JSONL corpora
│  ├─ db/
│  │  ├─ package.json             [built P0] exports ".", "./env"; scripts migrate, seed, reset, verify-schema, test, typecheck
│  │  ├─ migrations/NNNN_*.sql    [built P0 to P3] 0001_foundation, 0002_companies_boards_postings, 0003_ingest_runs, 0004_jobs_enrichment,
│  │  │                         0004a_llm_calls, 0004b_posting_geo, 0005_public_board, 0006_waitlist, 0007_rls_posture, 0008_auth, 0009_auth_hardening (Slice 2 and the RLS posture, 2026-10-29), 0010_resumes_profiles, 0010a_resumes_builder_drafts, 0010b_resumes_purge_retention (Slice 3), 0011_campus, 0011a_campus_functions, 0011b_campus_fixes, 0012_apply_pipeline, 0012a_apply_fixes, 0013_campus_audit, 0013a_apply_audit, 0013b_campus_rule_bounds (Slice 4 and apply, uncommitted, 2026-10-31), 0014_pilot_blockers (draft suggestions, the TPO read and write gate, `ops_audit`), 0015_picks_notify_drives (drive lifecycle, notifications, prefs, unsubscribe), 0016_review_fixes (resume guard trigger, waitlist erasure) (2026-11-01)
│  │  ├─ test/                    [built P0] migrator.test.ts, verify-schema.test.ts, queue.test.ts, helpers.ts
│  │  └─ src/
│  │     ├─ client.ts            [built P0] getPool, getDb, withAdmin, withUser, close
│  │     ├─ env.ts               [built P0] loadEnv (walks up), requireDatabaseUrl, isLocalUrl
│  │     ├─ migrate.ts           [built P0] CLI wrapper around migrator.ts
│  │     ├─ migrator.ts          [built P0] checksum runner (no pooler refusal yet)
│  │     ├─ reset.ts             [built P0] drops graphile_worker and public; refuses non-local URLs
│  │     ├─ seed.ts             [partial P0] stub: logs "nothing to seed yet"
│  │     ├─ verify-schema.ts, verify-schema-lib.ts   [built P0] tables, columns, nullability
│  │     ├─ ingest/{index,persist}.ts  [built P1] recordSourceSuccess (one-transaction board commit), recordSourceFailure, startRun, finalizeRun (soft-close), closeBoard, upsertCompanyBoard
│  │     ├─ enrich/{index,persist,coverage}.ts  [built P2] reference seeds (skills, FX), job and requirement writes, clustering candidates, pending-company listing, `refreshJobFacets`
│  │     ├─ schema/{ingest,jobs,llm,waitlist}.ts  [built P1 to P3] companies, company_boards, postings, ingest_runs, ingest_source_runs; jobs, job_requirements, skills, fx_rates; llm_calls; waitlist
│  │     ├─ queue.ts             [built P0] addJob over quickAddJob (owner connection, §2.3)
│     ├─ ops/index.ts          [built, uncommitted, 2026-11-01] pilot operator commands (campus, domains, CGPA rule, owner invite, platform switch). One transaction per command, each with an `ops_audit` row. Entry: `scripts/ops/main.ts`. See docs/ops.md
│  │     ├─ schema/ops.ts        [built P0] worker_heartbeats, feature_flags, rate_limits
│  │     ├─ schema/index.ts      [built P0]
│  │     ├─ verify-rls.ts        [built, 102 checks in verify]
│  │     ├─ verify-auth.ts       [built, 26 checks in verify]
│  │     ├─ auth/                [built Slice 2] opaque sessions (only the SHA-256 is stored), OTP challenges, account delete. No passwords
│  │     └─ index.ts            [built P0] public exports
│  ├─ ingest/                     [built P1 to P3] @hirelane/ingest. No src/index.ts yet (**Gap**: package.json names it as main and types). Workers deep-import src/run/index, src/connectors/index, src/contract, src/company/logo and src/company/transport. A barrel is open (§7, item 13)
│  │  ├─ boards.json, boards.candidates.json   [built P1] 119 verified boards (80 greenhouse, 28 ashby, 11 lever) and 154 candidates
│  │  ├─ src/contract.ts          [built P1] RawPosting, Connector, FetchBoardResult, FetchPolicyError, NormalizedPosting
│  │  ├─ src/normalize.ts         [built P1] normalize(), contentHash() (version v1)
│  │  ├─ src/connectors/          [built P1] shared.ts (makeConnector, fixed URLs, token guard), greenhouse.ts, lever.ts, ashby.ts
│  │  ├─ src/company/             [built P3] logo.ts (fetchCompanyLogo), logo-fetch.ts, transport.ts (createGuardedFetch, systemLookup), ip.ts, ico.ts, monogram.ts, name.ts, record-logos.ts, index.ts
│  │  ├─ src/run/                 [built P1] run.ts (runIngest, ingestBoard, seedBoards), policy.ts (createPolicyFetch: 30 s timeout, 20 MB cap, host spacing), retry.ts, fixtures.ts (fixture transport), boards.ts, args.ts
│  │  ├─ src/record/              [built P1] recordBoards (1 req/s per host; writes fixtures, boards.json, manifest), limiter.ts, fetch.ts, mini.ts (deriveMini), trim.ts, cli.ts (pnpm ingest:record)
│  │  ├─ src/cli.ts               [built P1] pnpm ingest:run (fixture or live)
│  │  └─ test/                    [built P1] 12 files, 166 tests (passing 2026-10-16)
│  │  ├─ src/jobtext.ts, jobtext/score.ts  [built Slice 3, uncommitted] `parsePastedJob`, `sourceHintFromUrl`, `scoreForProfile`; eval scoring. Engine-only: no route or action calls them yet. See docs/jobtext.md
│  │  ├─ src/scam.ts              [built Slice 3, uncommitted] `detectScamSignals` (7 signal ids). See docs/jobtext.md
│  │  ├─ src/resume/              [built Slice 1] sections, education, sensitive, verhoeff, text-layer, health. See docs/resume.md
│  │  ├─ src/eligibility/         [built Slice 1] criteria parser, evaluate, CGPA rule. See docs/eligibility.md
│  └─ agent/                      [partly built P2] @hirelane/agent. package.json exports "." and "./llm". Depends on @anthropic-ai/sdk, zod, @hirelane/db. 49 tests (verify, 2026-10-29). `src/llm/` and `src/mail/` exist
│     ├─ src/index.ts             [built P2] re-exports llm/index.ts
│     ├─ src/llm/                 [built P2, uncommitted] AnthropicProvider (anthropic.ts), FixtureProvider (fixture.ts), NullProvider (null.ts), factory.ts (HIRELANE_LLM_MODE: anthropic | fixture | off), prompt.ts, db-sink.ts (llm_calls metadata only), types.ts (DEFAULT_MODEL claude-opus-5-5). See docs/enrichment.md §5
│     ├─ test/                    [built P2] llm-anthropic, llm-mode, llm-null-fixture, llm-prompt
│     ├─ embeddings/              [planned P2] hash; local [P4]
│     ├─ resume/                  [planned P4] LLM parse. The deterministic parser is in `packages/engine/src/resume/` (Slice 1)
│     ├─ draft/, approval/, handoff/, tailor/   [planned P5]
│     ├─ mail/                    [built Slice 2] mailer contract, file outbox, code template. `mail/factory.ts` (2026-11-01): `createMailer`, which in production throws unless a real transport is injected. Inbound: the fixture-mailbox reader is in `workers/runner/src/tasks/inbound-*.ts` (Slice 4). No live mail transport yet (P6)
│     ├─ apply-address.ts        [built, uncommitted, 2026-11-01] `applyAddressOf`: the one `handle+reply_handle@domain` shape used by forms, the API and the answer record
│     └─ submit/                  [built, uncommitted, 2026-10-31] `allowlist.ts` (2026-11-01): the apply-host allowlist, checked before any transport call. Fixture-only executor: `execute.ts` (the gates and order), `transport.ts` (the host guard, fixture hosts only), `challenge.ts` (CAPTCHA, challenge and login markers), `forms.ts`, `payload.ts`, reached through `apply:submit`. No live transport. `src/apply-mode.ts` reads `HIRELANE_AUTO_APPLY`. See docs/apply.md
├─ packages/services/            [built Slice 3, uncommitted] @hirelane/services: the shared service layer (Amendment B §11). Depends on db, engine, vault, agent only (rule `services-deps`). Files: `resumes.ts` (upload, list, get, confirm, download, delete), `eligibility.ts`, `builder.ts` and `builder-steps.ts`, `me.ts` (get, export), `idempotency.ts`, `seal.ts`, `aad.ts`, `parsed.ts`, `provenance.ts`, `errors.ts` (`ServiceError`, `toProblem`), `ctx.ts`, `db.ts`, `views.ts`. Slice 4 (uncommitted, 2026-10-31) adds `campus/` (membership and join codes, roster, drives, TPO staff, outcomes, NAAC; see docs/campus.md) and `apply/` (swipe, consent, apply address, tracker, inbox, answer bank; see docs/apply.md). 2026-11-01 adds `picks/` (ranking, eval, `getPicks`; see docs/picks.md), `paste/` (`checkPastedJob`; see docs/picks.md), `notify/` (Home rows, the sweep, the unsubscribe token and preferences; see docs/notifications.md), and `campus/drive-inbox.ts` (draft, announce, close, reach), `campus/roster-preview.ts` and `campus/ist.ts`. Tests in `packages/services/test/`
├─ packages/vault/               [built Slice 2] @hirelane/vault: master key provider, HMAC subkeys (`hmac`), blob storage (`HIRELANE_STORAGE_DIR`), `setup-keys.ts`
├─ workers/runner/                [built, partial P0] package name @hirelane/runner
│  ├─ src/index.ts                [built P0] graphile-worker bootstrap, concurrency 4, pollInterval 2000
│  ├─ src/enrich-cli.ts           [built P2] `pnpm enrich:run`, in-process enrichment (no queue), uses the enrich-core functions
│  ├─ src/resume/extract/        [built Slice 1, library] `extractInThread` (sandboxed child), `extractResume`, DOCX zip guard, PDF. Registered through `tasks/resume-extract.ts` (Slice 3). See docs/resume.md
│  ├─ src/resume/pipeline.ts      [built Slice 3, uncommitted] the extraction pipeline: gate, extract, normalise, text layer, sections, mask, health, education. No DB, no network, 0 LLM calls
│  ├─ src/resume/render/          [built Slice 3, uncommitted] pdfkit builder renderer (`answers.ts`, `index.ts`): one page, single column
│  ├─ src/tasks/resume-common.ts, resume-extract.ts, resume-render.ts, resume-purge.ts, resume-stuck.ts   [built Slice 3, uncommitted] resume:extract, resume:render, resume:purge, resume:purge-sweep, resume:stuck-sweep, idempotency:sweep. All registered in `tasks/index.ts`
│  ├─ src/tasks/campus-stats.ts, apply-common.ts, apply-submit.ts, inbound-scan.ts, inbound-classify.ts, inbound-mime.ts   [built Slice 4, uncommitted, 2026-10-31] `campus:stats` (nightly, drive verdicts and counts, roster apply), `apply:submit` and `apply:sweep` (the executor's repo and gates), `inbound:scan` (fixture mailbox; on the crontab every 5 minutes since 2026-11-01). Registered in `tasks/index.ts`. See docs/campus.md and docs/apply.md
│  ├─ src/tasks/housekeeping.ts, notify-sweep.ts   [built, uncommitted, 2026-11-01] `housekeeping:sweep` (daily, retention for hashed identifiers) and `notify:sweep` (every 10 minutes; drive rows, then email). See docs/notifications.md
│  ├─ src/tasks/index.ts          [built P0, extended P1 to P2, Slices 3 and 4, 2026-11-01] taskList = { heartbeat, ingest, enrich, company, resume, campus stats, apply, inbound, housekeeping, notify }. The startup guard refuses to start with auto-apply on and no apply domain
│  ├─ src/tasks/ingest.ts         [built P1] ingest:schedule, ingest:source, ingest:finalize; deps injectable (IngestDeps)
│  ├─ src/tasks/enrich.ts         [built P2] enrich:schedule, enrich:company, enrich:posting (registered, no caller), facets:refresh; deps injectable (EnrichDeps)
│  ├─ src/tasks/enrich-core.ts    [built P2] enrichCompany, enrichPostingById, ensureReferenceData, syncJobLifecycle, loadEngineFx
│  ├─ src/tasks/enrich-raw.ts     [built P2] replays `postings.raw` through the real ingest connector, so the engine gets a RawPosting
│  ├─ src/tasks/company.ts        [built P3, registered 2026-11-01, no cron entry] company:logo; fixture or live mode (SSRF-guarded)
│  ├─ src/tasks/heartbeat.ts      [built P0]
│  ├─ test/runner.test.ts         [built P0] heartbeat behaviour, task list, crontab
│  ├─ test/ingest.tasks.test.ts   [built P1]
│  ├─ test/enrich.tasks.test.ts, test/enrich.test.ts   [built P2]
│  ├─ test/company.tasks.test.ts  [built P3]
│  └─ crontab                     [partial P0, extended P1 to P2, Slices 3 and 4 (resume, campus:stats, apply:sweep, inbound:scan), housekeeping:sweep and notify:sweep (2026-11-01)] heartbeat, `7 */6 * * * ingest:schedule`, `37 */6 * * * enrich:schedule`; full schedule in §4.2
├─ apps/web/                      [built P0 to P3, landing v3 and waitlist] Next 15, React 19, Tailwind v4, :3001. Depends on @hirelane/db and @hirelane/engine
│  ├─ middleware.ts               [built P3] markdown negotiation for /job/{slug} (lib/negotiate.ts). Rewrites to /md/job/{slug}, 404s direct /md/*, adds Vary and a Link alternate to HTML
│  ├─ app/layout.tsx, wordmark.tsx, source-badge.tsx, globals.css, icon.svg, fonts/   [built P0] shell, wordmark, ATS source marks, Overpass
│  ├─ app/                        [built P3] pages:
│  │  ├─ page.tsx                 `/` landing v3 [built, landing]: components/landing-v3/* (hero, sections, stack, tour); data from lib/queries/landing.ts; road photos from lib/landing-v3/photos.ts
│  │  ├─ jobs/page.tsx            `/jobs` ledger with URL-state filters; only the bare ledger is indexable
│  │  ├─ job/[slug]/page.tsx      `/job/{slug}` HTML job page (open or closed)
│  │  ├─ companies/page.tsx, company/[slug]/page.tsx   `/companies`, `/company/{slug}`
│  │  ├─ lists/page.tsx, lists/[slug]/page.tsx         `/lists`, `/lists/{slug}` (ISR, no paging)
│  │  ├─ how-it-works/, compare/, about/, status/      product pages
│  │  ├─ api-docs/page.tsx        `/api-docs`, rendered from buildOpenApi()
│  │  └─ ops/ingest/page.tsx, ops/session/route.ts    `/ops/ingest`, guarded by the ops token cookie (lib/ops-auth.ts)
│  ├─ app/api/health/route.ts     [built P0] `/api/health`
│  ├─ app/api/waitlist/route.ts   [built, landing] POST `/api/waitlist` (dynamic); `createWaitlistHandler` in lib/waitlist.ts. The INSERT runs through `withAdmin`, not as `hirelane_app`, so the INSERT-only grant from migration 0006 is unused by this path
│  ├─ app/api/public/stats/autopilot/{route,handler}.ts   [built, landing] `/api/public/stats/autopilot`: 60 requests per 60 s, `withAdmin`, engine `ROLE_FAMILIES`, snapshot from lib/autopilot-proxy.ts
│  ├─ app/dev/ui/, app/dev/landing-kit/   [built, dev only] `/dev/ui` and `/dev/landing-kit`. Both call `notFound()` when `NODE_ENV` is `production`. Both pages set `robots` to noindex
│  ├─ app/api/public/             [built P3] the public JSON API (the `stats/autopilot` route sits here too, see above)
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
│  ├─ lib/queries/landing.ts      [built, landing] landing loaders: live counts, freshest-jobs ticker, demo card stack, one real salary trace. One cached read (300 s, tag `jobs`)
│  ├─ lib/landing-v3/photos.ts    [built, landing] road photographs and sign-panel rectangles for the landing hero
│  ├─ lib/waitlist.ts             [built, landing] waitlist handler (`createWaitlistHandler`)
│  ├─ lib/autopilot-proxy.ts      [built, landing] snapshot and per-week figures for the autopilot stats route
│  ├─ lib/queries/jobs.ts         [built P3] the board query: filter, total, page and facets in one parameterised statement; appOrigin(); toPublicJob()
│  ├─ lib/queries.ts              [stub P0, dead] getFreshestJobs has no callers. It sits beside lib/queries/ and should be deleted (§7, item 12)
│  ├─ lib/session.ts              [stub P0] getSession is a placeholder until P4
│  ├─ lib/auth/                   [built Slice 2, uncommitted] flags, origin, cookies, session, pending-signup, email-code, google, linkedin, oidc-shared, erasure, request, deps. See docs/auth.md
│  ├─ app/auth/linkedin/{start,callback}/route.ts   [built Slice 3, uncommitted] LinkedIn OIDC route handlers. See docs/auth.md §4d
│  ├─ app/api/v1/                 [built Slices 3 and 4, uncommitted; picks and paste added 2026-11-01] 47 route files (base, campus, tpo, apply, picks, paste), thin adapters over @hirelane/services. `lib/openapi-picks.ts` (picks and paste operations). `lib/http/v1.ts` is the wrapper (accounts flag, session, Origin, rate limit, Idempotency-Key). Operation lists: `lib/openapi-campus.ts`, `lib/openapi-apply.ts`, `lib/openapi-types.ts`. `lib/adapters/` maps service output to the campus and apply screens' view models. Operations, auth and errors in docs/public-api.md §14. OpenAPI at app/api/v1/openapi.json/route.ts
│  ├─ app/campus/                 [built Slice 4, uncommitted] TPO console pages: overview, drives, outcomes, settings, students. The student's drive inbox is `app/(app)/drives/`. See docs/campus.md
│  ├─ app/(app)/resume, you, paste, home, drives, tracker, ...   [built Slice 3 screens] server actions wrap the services. /you/eligibility is NOT built (folder holds actions.ts only). 2026-11-01: `picks/` (the deck), `welcome/` (apply and college steps), `tracker/[id]`, and `lib/student/` (the view loaders and maps, sample data)
│  ├─ app/unsubscribe/            [built, uncommitted, 2026-11-01] GET shows a confirm button; the POST action (`actions.ts`) turns off the two optional email kinds. See docs/notifications.md §4
│  ├─ app/auth/google/{start,callback}/route.ts   [built Slice 2] Google OIDC route handlers
│  ├─ app/(auth)/, app/(app)/     [built Slice 2] server actions only (signin, signin/code, welcome, you). No page.tsx yet, so the UI is not reachable
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

1. **FORCE RLS versus `withAdmin`** (§3.1). **Decided 2026-10-28:** drop FORCE, keep ENABLE, `hirelane_app` owns nothing, add the `withadmin-allowlist` guard, and run `verify-rls` as a non-superuser owner. **Implemented 2026-10-29:** `0007_rls_posture` enables RLS (ENABLE, not FORCE), `scripts/withadmin-guard.ts` runs in `verify`, and `verify-rls` passes 102 checks in `verify`. **Still to confirm:** the owner-side `verify-rls` run as a non-superuser owner on staging and prod. Design source: `docs/design/hld-lld-core-loop.md` (the core-loop HLD/LLD).
2. **`@hirelane/db` depends on `graphile-worker`.** Enqueueing uses the owner connection after commit (§2.3). PLAN §5.2's "may import" column should be amended to match. **Still open** (checked 2026-10-28: `packages/db/package.json` lists `graphile-worker`).
3. **Drizzle pgvector type.** `jobs.embedding vector(384)` now exists (migration 0004), so the type is exercised. **Still open:** no tooling checks column types, so confirm the match with the type check in item 9.
4. **Unnamed secrets** for inbound mail, the mailer, Razorpay and Stripe. Name them in the phase that introduces each one, then add them to §5 and `.env.example` as blanks. **Still open.**
5. **Engine clock and randomness ban.** Choose the enforcement mechanism (lint rule or guard script) in Phase 2. **Still open:** checked 2026-10-28. `.dependency-cruiser.cjs` has no clock or randomness rule, and `scripts/` has no guard for it.
6. **Owner membership in `hirelane_app`.** Add `GRANT hirelane_app TO current_user` (tolerating `duplicate_object` and `invalid_grant_operation`) in a migration, so `withUser` works with a non-superuser owner. **Done in code 2026-10-29:** `0007_rls_posture` runs the grant (tolerating the errors), and `0009_auth_hardening` does the same for `hirelane_auth`. If the migrator may not grant, the migration only emits a NOTICE, so a role admin must run it. Check the NOTICE on staging and prod before deploying. Previously: no migration contained `GRANT hirelane_app` (checked 2026-10-28). Needed before any user-scoped query runs outside a superuser (Phase 4 at the latest).
7. **Direct-connection TLS and pooler refusal.** Apply the TLS rule to the graphile-worker connection and to `addJob`, and refuse a `-pooler.` host in `migrate`. **Still open.**
8. **Worker time zone and concurrency.** Set `TZ=UTC` for the worker, and raise `concurrency` to 8 when ingest lands. **Both still open** (checked 2026-10-28): `workers/runner/src/index.ts` is at `concurrency: 4`, ingest has landed, and `TZ` is not set anywhere.
9. **`verify-schema` coverage.** Add type and `pg_indexes` checks, as §3 requires. **Still open.**
10. **Missing tooling referenced by the docs.** `pnpm setup:keys` (referenced by `.env.example`) does not exist. Either add it in Phase 4 with the master key, or remove the reference. **Closed 2026-10-29:** the root `package.json` has `setup:keys`, and `packages/vault/src/setup-keys.ts` exists.
11. **Phase 0 commit state.** **Closed 2026-10-28:** the Phase 0 files are tracked in git (for example `packages/db/src/client.ts` and `packages/engine/src/index.ts`). The PLAN.md Phase 0 acceptance checklist was not re-verified in this pass.
12. **Dead stub `apps/web/lib/queries.ts`.** Delete it. `@/lib/queries` resolves to this file rather than to the `lib/queries/` directory, and nothing calls `getFreshestJobs`. **Open** (added 2026-10-28).
13. **No `@hirelane/ingest` barrel.** Add `packages/ingest/src/index.ts`, or change `package.json` `main` and `types`. Until then the runner deep-imports `src/run/index`, `src/connectors/index`, `src/contract`, `src/company/logo` and `src/company/transport`. **Open** (added 2026-10-28).
14. **`company:logo` is not registered.** Spread `createCompanyTasks()` into `taskList` in `workers/runner/src/tasks/index.ts`, and add the monthly crontab entry. **Open** (added 2026-10-28).
15. **`enrich:posting` has no caller.** It is registered in `tasks/enrich.ts` but nothing enqueues it. Either wire it into the enrich flow or remove it. **Open** (added 2026-10-28).
16. **Engine `src/index.ts` placeholder.** Delete the leftover `export const x=1` line. **Closed 2026-10-29:** the line is gone.
17. **Resume extractor is not wired.** `workers/runner/src/resume/extract/` is a library. No task or route calls it, so nothing reads an upload yet. Wired in Slice 3 as `resume:extract` (§4.3). **Closed in code 2026-10-29**; it is not yet run against a live upload path.
18. **Eligibility verdict gate is partial.** `engine:eval` gates criterion accuracy and unknown-to-fail, but not pass-to-fail verdict errors. See `docs/eligibility.md` §7. **Open** (added 2026-10-29).
19. **Auth pages now exist** (checked 2026-10-29): `page.tsx` for `/signin`, `/signin/code` and `/welcome`, and `/you` under `(app)`. Logout and delete redirect to `/signin` and `/`. See `docs/auth.md`. **Closed** for the missing-page gap; browser checks are in `docs/screens/auth-*.png`.
20. **Mail has no real transport.** The file outbox is the only transport, so code mail is not delivered in production until an owner decision. **Open** (added 2026-10-29).
21. **Two origin variables.** Public job URLs read `APP_ORIGIN`. Auth reads `HIRELANE_APP_ORIGIN`. Pick one name, or document both. **Open** (added 2026-10-29).
22. **`pnpm budget` is RED (exit 1).** Limit 100 kB gzip first-load JS per student route. Measured 2026-10-29 in an isolated mirror: `/signin`, `/signin/code`, `/welcome` and `/you` at 190.9 kB; `/resume` at 106.9 kB; `/terms` (reference, no student UI) at 106.8 kB. Next 15 and React 19 alone are about 106.6 kB shared, so the limit as written cannot pass even for an empty page. **Owner decision:** a delta over the framework, or a higher absolute cap. **Open** (added 2026-10-29).
23. **Radix chunks on the auth routes (lead, not verified).** The extra ~84 kB on `(auth)` routes is thought to come from `components/shadcn/button.tsx` importing `Slot` from the `radix-ui` barrel, and the `Label` primitive in `shadcn/input`. The fix may be a narrower import or a dependency change. Not verified end to end. **Open.**
24. **`withAdmin` allowlist entry for `apps/web/lib/auth/erasure.ts`** needs owner sign-off (§3.1, `docs/auth.md` §7). **Open** (added 2026-10-29).
25. **Child network isolation** for `resume:extract` is a deploy precondition, not code. Node's permission model does not restrict the network. **Open** (`docs/resume.md`, "Deploy preconditions").
26. **`/you/eligibility` is not built.** The route folder holds only `actions.ts`, and `pnpm budget` lists it as "not built". **Open** (added 2026-10-29).
27. **`@hirelane/jobtext` is engine-only.** `parsePastedJob`, `scoreForProfile` and `detectScamSignals` have no caller outside `packages/engine`. **Open** (added 2026-10-29). See `docs/jobtext.md`.
28. **LinkedIn sign-in is not verified against live LinkedIn.** Tests use a mock issuer. Check the PKCE advertisement and the `iss` value on a live discovery document before the pilot. **Open** (added 2026-10-29). See `docs/auth.md` §4d.
29. **Slice 3 migrations are 0010, 0010a and 0010b.** The build plan's "0009" label is stale, and Slice 4's "0010 campus tables" number is now taken. **Open** (added 2026-10-29), for the plan to renumber.
