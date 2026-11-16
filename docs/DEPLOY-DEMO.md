# Hirelane public demo: deploy runbook

Written 2026-11-07 for branch `feat/r0-r1-slice`. Nothing in this runbook has been run on any hosted service. You log in to each service yourself, and every command here is for your own laptop unless it says otherwise.

Target stack: Vercel for `apps/web`, Neon Postgres for the database, Fly.io for the graphile worker (`workers/runner`). Amazon SES comes later.

Demo rules (do not relax them):

- Synthetic data only. Students are `student01..24@demo-college.example.test`.
- 0 LLM calls: `HIRELANE_LLM_MODE=off`, `ANTHROPIC_API_KEY` unset.
- No live employer submission: `HIRELANE_AUTO_APPLY=fixture`, `HIRELANE_INGEST_MODE=fixture`.
- Never set `HIRELANE_SAMPLES=1` or `HIRELANE_INSECURE_DEV_COOKIE` in production.

What is in the kit (all new files, uncommitted):

| File | Purpose |
| --- | --- |
| `docs/DEPLOY-DEMO.md` | This runbook |
| `.env.production.example` | Every production variable, with what it does. No secret values. |
| `apps/web/vercel.json` | Install and build commands for a monorepo with Root Directory `apps/web` |
| `workers/runner/Dockerfile` | Worker image, built from the repo root. No secrets, runs as `node`. |
| `workers/runner/Dockerfile.dockerignore` | Keeps `.env*`, `node_modules`, `.next`, `storage` out of the image |
| `workers/runner/fly.toml.template` | Fly config with placeholders. Copy it to `fly.toml` at the repo root. |
| `scripts/demo-smoke.sh` | Read-only smoke test of the key routes (GET only) |
| `scripts/test/deploy-kit.test.ts` | Guards for all of the above (26 tests) |
| `.gitignore` | One line added so `.env.production.example` is committable |

## 0. Read this first: what will block or surprise a real officer demo

Each row was checked against the code on 2026-11-07.

| # | Finding | What it means tomorrow | What this runbook does |
| --- | --- | --- | --- |
| 1 | `pnpm demo:seed` refuses any non-local database and refuses `NODE_ENV=production` (`scripts/demo-seed-lib.ts`, with tests). | The seed cannot run against Neon. Changing that guard is a deliberate code change and is not part of this kit. | Section 3 seeds a local scratch database, dumps only the seeded tables, and restores them into Neon. |
| 2 | The slug `sample-university-bengaluru` does not exist anywhere in the repo, and `pnpm demo:seed` takes no argument. | Typing that command does nothing useful. | The seeded campus is named `Demo Institute of Technology (sample)`. |
| 3 | No production mail transport exists. `createMailer()` throws in production without one. | Email-code sign-in, the email college join, and notification emails fail. | Sign-in uses Google or LinkedIn (you register the OAuth app). The code join for students still works. |
| 4 | Resume uploads are written to `HIRELANE_STORAGE_DIR` on the web host's disk. Vercel has no shared disk, so the Fly worker cannot read them. | Resume upload is not demo-safe. Do not promise it to officers. | `HIRELANE_STORAGE_DIR` stays empty on Vercel. Decision for you in section 10. |
| 5 | `HIRELANE_DEMO=1` is read by the web app (accounts on, samples off, LLM off, demo door open). Demo sessions are shared accounts. | Do not collect real data on the demo deploy. | Set it on the demo project only, with `TRUST_X_REAL_IP=1`. Leave `HIRELANE_LLM` empty. |
| 6 | The sitemap, `robots.txt` and `openapi.json` build their links from `APP_ORIGIN`, which defaults to `http://localhost:3001`. `HIRELANE_APP_ORIGIN` does not feed them. | Without `APP_ORIGIN`, search engines are sent to localhost. | Set both to the public origin. The smoke test fails if the sitemap mentions localhost. |
| 7 | `notify:sweep` and campus mail call `createMailer()` in production. | The worker logs `mail: no production transport is configured` every 10 minutes. Public pages are unaffected. | Expected until a transport exists. |
| 8 | The local verify scripts (`db:verify-*`) run as the local docker superuser. The web app switches to the `hirelane_app` role for signed-in queries (`withUser`). Neon's owner role is a managed role, not that local superuser. | If `SET ROLE hirelane_app` is refused on Neon, signed-in pages fail with a permission error. This is the one thing the local checks cannot prove. | Section 8 exercises signed-in pages. Treat any `permission denied` as a stop-and-report. |
| 9 | `.env.example` lists `HIRELANE_LLM_MODE` as `auto|live|fixture|off`. The code accepts `anthropic|fixture|off`. | Using `live` would silently fall back to off. | The kit uses `off`. |

## 1. Accounts you log in to yourself

| Service | Why | Notes |
| --- | --- | --- |
| Domain registrar | The public name, for example `demo.<your-domain>` | Any registrar. |
| Vercel | Hosts `apps/web` | Connect GitHub and grant access to the private repo `adhikbuilds/hirelane`. |
| Neon | Postgres for the demo | Create one project. |
| Fly.io | Runs the worker | Install `flyctl` and log in. |
| Google Cloud (and/or LinkedIn developer) | Sign-in for officers and students | Create a Web OAuth client. |

## 2. Local preparation (no accounts needed)

### 2.1 Commit the kit before you deploy

Vercel and Fly build what is committed. This tree has many unrelated uncommitted changes from other work. Commit only the deploy-kit files to the branch you deploy from, or to a clean branch, and only when you decide to. Do not deploy from this tree as it stands.

### 2.2 Create the secrets file (outside the repo)

```sh
umask 077
touch "$HOME/hirelane-demo.env"
chmod 600 "$HOME/hirelane-demo.env"
open -e "$HOME/hirelane-demo.env"
```

Paste this template into the file and keep it out of git. Put each comment on its own line.

```
# Secrets and identifiers for the demo. chmod 600. Never copy into the repo.
HIRELANE_MASTER_KEY=
HIRELANE_OPS_TOKEN=
NEON_DATABASE_URL=
DEMO_HOST=demo.YOUR-DOMAIN
APPLY_DOMAIN=apply.YOUR-DOMAIN
MX_AUTHSERV_ID=mx.YOUR-DOMAIN
FLY_APP=hirelane-runner-demo
FLY_REGION=bom
DEMO_JOIN_CODE=
```

Replace `YOUR-DOMAIN` with your domain. `FLY_REGION=bom` is Mumbai; pick another region if you prefer.

### 2.3 Generate the master key and the ops token

```sh
cd /Users/aagarwal/hirelane && pnpm -s setup:keys
```

The command prints one line, `HIRELANE_MASTER_KEY=...`. Paste that value into the file.

```sh
openssl rand -hex 32
```

Paste that output as `HIRELANE_OPS_TOKEN`.

The master key must be identical on Vercel, Fly, and the local seed. It encrypts stored data and derives the campus join-code and mailbox hashes. Never rotate it casually.

### 2.4 Gate before deploying

```sh
cd /Users/aagarwal/hirelane && pnpm verify
```

Expected: the tail reads `Auth verification passed (26 checks).` and the exit code is 0. `pnpm test:scripts` runs the deploy-kit guards (expect 26 passed).

## 3. Database: Neon project, migrations, then the seed

### 3.1 Create the Neon project

1. In the Neon console, create a project named `hirelane-demo`. Pick the region closest to Bengaluru that Neon offers, and Postgres 16 to match the local database.
2. Neon supports the extensions the migrations use (`citext`, `pg_trgm`, `pgcrypto`, `vector`). If a migration fails on an extension, stop and report it.
3. Create a branch named `before-migrate` now. It is the restore point if anything goes wrong.
4. Copy the direct connection string. It includes `sslmode=require`. Paste it into the secrets file as `NEON_DATABASE_URL`.

### 3.2 Run the migrations against Neon

Run this in a subshell so `DATABASE_URL` does not leak into your shell (the dev server reads `.env.local` only when `DATABASE_URL` is unset):

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; cd /Users/aagarwal/hirelane && DATABASE_URL="$NEON_DATABASE_URL" pnpm db:migrate )
```

Expected last line: `Schema up to date (27 applied, 0 unchanged).`

Running it again must print `(0 applied, 27 unchanged)`. If migration 0001 fails with a permission error on `CREATE ROLE`, stop and report it. That needs a Neon answer.

### 3.3 Seed a local scratch database (the seed cannot target Neon)

The dev Postgres container must be running (`pnpm db:up`). Create a scratch database in it. If it says the database already exists, continue.

```sh
docker exec hirelane-postgres psql -U hirelane -d hirelane -c "CREATE DATABASE hirelane_demo OWNER hirelane"
```

Migrate and seed the scratch database. `HIRELANE_DEMO=1` unlocks the seed. The database URL is local, so the guard passes.

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; cd /Users/aagarwal/hirelane && export DATABASE_URL=postgres://hirelane:hirelane@localhost:5433/hirelane_demo && export HIRELANE_DEMO=1 && pnpm db:migrate && pnpm demo:seed )
```

The seed prints the join code once: `demo campus created. join code XXXX ...`. Copy that code into the secrets file as `DEMO_JOIN_CODE`.

Check the local verifiers (they are local-only by design) and the seeded counts:

```sh
( cd /Users/aagarwal/hirelane && export DATABASE_URL=postgres://hirelane:hirelane@localhost:5433/hirelane_demo && pnpm db:verify-schema && pnpm db:verify-rls && pnpm db:verify-auth )
```

```sh
docker exec hirelane-postgres psql -U hirelane -d hirelane_demo -At -c "select (select count(*) from campuses), (select count(*) from users), (select count(*) from cohort_members), (select count(*) from drives), (select count(*) from outcomes)"
```

Expected: `1|24|24|2|8`.

### 3.4 Dump only the seeded tables and restore them into Neon

The dump includes just the ten tables the seed writes. `--on-conflict-do-nothing` keeps the restore safe to repeat.

```sh
docker exec hirelane-postgres pg_dump -U hirelane -d hirelane_demo --data-only --inserts --on-conflict-do-nothing -t campuses -t campus_domains -t cohorts -t tpo_members -t users -t consents -t cohort_members -t eligibility_profiles -t drives -t outcomes > "$HOME/hirelane-demo-seed.sql"
```

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; docker exec -i -e NEON_URL="$NEON_DATABASE_URL" hirelane-postgres sh -c 'psql "$NEON_URL" -v ON_ERROR_STOP=1 -q' < "$HOME/hirelane-demo-seed.sql" )
```

Check the counts on Neon. Expected `1|24|24|2|8`, and `0` model calls:

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; docker exec -e NEON_URL="$NEON_DATABASE_URL" hirelane-postgres sh -c 'psql "$NEON_URL" -At -c "select (select count(*) from campuses), (select count(*) from users), (select count(*) from cohort_members), (select count(*) from drives), (select count(*) from outcomes), (select count(*) from llm_calls)"' )
```

If the restore fails partway, fix the cause and run the same restore again. The `ON CONFLICT` clause makes it safe. The dump and the scratch database contain synthetic data only; delete them when you are done with `rm "$HOME/hirelane-demo-seed.sql"`.

## 4. Domain: buy it now, point DNS after the Vercel project exists

1. Buy the domain at any registrar. Choose the name for `DEMO_HOST` (for example `demo.<your-domain>`).
2. Do the Vercel project in section 5 first, then add the domain there. Vercel shows the exact DNS records to create.
3. At the registrar, create the record Vercel shows. At the time of writing, the usual pattern is:
   - Subdomain: `CNAME` for `demo` pointing at `cname.vercel-dns.com`
   - Apex, if you want it: `A` for `@` pointing at `76.76.21.21`

   The values in the Vercel dashboard win over this page.
4. Check the record from your laptop:

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; dig +short CNAME "$DEMO_HOST" )
```

5. Wait until Vercel shows the domain as valid. Vercel then issues the TLS certificate.

`APPLY_DOMAIN` (`apply.<domain>`) needs no DNS record yet. Inbound employer mail is not set up, and auto-apply is fixture-only.

## 5. Vercel: the web app

### 5.1 Create the project

1. In Vercel, choose Add New, then Project, and import `adhikbuilds/hirelane`.
2. Set these before the first deploy:
   - Root Directory: `apps/web` (click Edit)
   - Framework Preset: Next.js (detected)
   - Node.js Version: 22.x (Settings, then Build and Deployment)
   - Install and Build commands: leave them to `apps/web/vercel.json`. Check that the settings show `cd ../.. && pnpm install --frozen-lockfile` and `cd ../.. && pnpm --filter @hirelane/web build`.
   - Include source files outside the Root Directory: leave on. The workspace packages need it.
   - Production Branch: the branch you chose in 2.1.

### 5.2 Environment variables (Production scope only)

Add each variable under Settings, then Environment Variables, with the Environment set to Production only. Tick Sensitive for every secret. Copy values from the secrets file.

| Name | Value | What it is |
| --- | --- | --- |
| `DATABASE_URL` | `NEON_DATABASE_URL` | The Neon database. Sensitive. |
| `HIRELANE_MASTER_KEY` | from the file | Encryption and HMAC key. Same on Vercel, Fly and the seed. Sensitive. Never rotate casually. |
| `HIRELANE_OPS_TOKEN` | from the file | Gate for `/ops/ingest`. Sensitive. |
| `HIRELANE_APP_ORIGIN` | `https://DEMO_HOST` | Public origin for OAuth redirects and origin checks. |
| `APP_ORIGIN` | `https://DEMO_HOST` | Origin for sitemap, robots.txt and openapi links. Must be set, see section 0, row 6. |
| `HIRELANE_APPLY_DOMAIN` | `APPLY_DOMAIN` | Domain of each student's apply address. Required in production. |
| `HIRELANE_MAIL_AUTHSERV_ID` | `MX_AUTHSERV_ID` | Authserv id of the receiving mail server. Set now for consistency. |
| `HIRELANE_AUTO_APPLY` | `fixture` | Right swipes create fixture applications only. Never `live`. |
| `HIRELANE_LLM_MODE` | `off` | No model calls. |
| `HIRELANE_INGEST_MODE` | `fixture` | Recorded fixtures only. |
| `HIRELANE_ACCOUNTS` | `1` | Turns sign-in on. Use `0` to turn it off again. |
| `TRUST_X_REAL_IP` | `1` | Vercel overwrites `x-real-ip`, so the rate limiter can trust it. |
| `TRUST_PROXY_HOPS` | `1` | One proxy in front, for rate limits. |
| `HIRELANE_GOOGLE_CLIENT_ID` | from Google Cloud | Google sign-in. Set both Google values or neither. |
| `HIRELANE_GOOGLE_CLIENT_SECRET` | from Google Cloud | Google sign-in secret. Sensitive. |
| `LINKEDIN_CLIENT_ID` | from LinkedIn | Optional. Set both LinkedIn values or neither. |
| `LINKEDIN_CLIENT_SECRET` | from LinkedIn | Optional. Sensitive. |

Leave these unset on Vercel. Setting any of them changes behaviour in the wrong direction for the demo:

- `NODE_ENV` (Vercel sets `production` itself)
- `HIRELANE_DEMO` (demo deploy only; see known limit 5)
- `HIRELANE_SAMPLES` (opens every `/dev` page)
- `HIRELANE_INSECURE_DEV_COOKIE`
- `HIRELANE_FAULTS`
- `ANTHROPIC_API_KEY` (would allow model calls)
- `HIRELANE_STORAGE_DIR` (no shared disk; see section 0, row 4)

Google sign-in: in Google Cloud, create a Web application OAuth client. Add the authorized redirect URI `https://DEMO_HOST/auth/google/callback`. For LinkedIn, the redirect URI is `https://DEMO_HOST/auth/linkedin/callback`. Put the client ID and secret into Vercel. Environment variable changes take effect only on a new deployment, so redeploy after you add them.

### 5.3 Deploy and check

1. Start a deployment: push the production branch, or choose Redeploy.
2. Check the deployment URL, which is `https://<project>.vercel.app` until the domain is attached:

```sh
curl -sS https://PROJECT.vercel.app/api/health
```

Expected: `{"ok":true}`.

3. Attach the domain: Settings, then Domains, add `DEMO_HOST`, and follow section 4.
4. Run the smoke test (section 8) against the public origin.

## 6. Fly.io: the graphile worker

### 6.1 Install and log in (you do this)

```sh
brew install flyctl
fly auth login
```

### 6.2 Create the Fly config at the repo root

The build context is the repo root, so `fly.toml` must live there. Fill in the placeholders from the secrets file:

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; cd /Users/aagarwal/hirelane && cp workers/runner/fly.toml.template fly.toml && sed -i '' -e "s/<FLY_APP_NAME>/$FLY_APP/" -e "s/<FLY_REGION>/$FLY_REGION/g" -e "s/<DEMO_HOST>/$DEMO_HOST/g" -e "s/<APPLY_DOMAIN>/$APPLY_DOMAIN/" -e "s/<MX_AUTHSERV_ID>/$MX_AUTHSERV_ID/" fly.toml )
```

Check that the `[env]` values now show your domain, and that no placeholder is left in an uncommented line:

```sh
cd /Users/aagarwal/hirelane && grep -n '= "' fly.toml
```

`fly.toml` contains no secrets, so committing it is fine.

### 6.3 Create the app and set its secrets

The secrets are passed on stdin, so they stay out of your shell history and process arguments:

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; fly apps create "$FLY_APP" && printf 'DATABASE_URL=%s\nHIRELANE_MASTER_KEY=%s\n' "$NEON_DATABASE_URL" "$HIRELANE_MASTER_KEY" | fly secrets import -a "$FLY_APP" )
```

### 6.4 Deploy and start one machine

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; cd /Users/aagarwal/hirelane && fly deploy -a "$FLY_APP" --remote-only && fly scale count 1 -a "$FLY_APP" )
```

### 6.5 Check the worker

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; fly logs -a "$FLY_APP" --no-tail | head -40 )
```

Expected: a line `worker started; tasks: ...`. Expected noise: `mail: no production transport is configured` from `notify:sweep` (section 0, row 7).

Check the heartbeat table on Neon. The newest row should be from the last two minutes, because the heartbeat task runs every minute:

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; docker exec -e NEON_URL="$NEON_DATABASE_URL" hirelane-postgres sh -c 'psql "$NEON_URL" -At -c "select max(at) from worker_heartbeats"' )
```

Public job pages stay empty until the first ingest. The schedule runs at minute 7 every six hours. To load jobs earlier, run the fixture ingest on the worker. This has not been run by me, so treat it as an unverified command:

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; fly ssh console -a "$FLY_APP" -C "sh -c 'cd /app && pnpm ingest:run'" )
```

### 6.6 Optional: build the image locally to test it

```sh
cd /Users/aagarwal/hirelane && docker build -f workers/runner/Dockerfile -t hirelane-runner .
docker run --rm -e DATABASE_URL=postgres://probe:probe@127.0.0.1:1/none hirelane-runner
```

Expected: the process starts, then fails to connect to the probe address. That proves the modules load. It is not a real run.

## 7. Accounts and officer access

### 7.1 Sign-in works without email

Officers and students sign in with Google (or LinkedIn). Email-code sign-in fails until a mail transport exists (section 0, row 3). The seat claim reads the verified mailbox of the signed-in account (`verifiedMailboxIn` in `packages/services/src/campus/tpo.ts`), so the officer must sign in with the invited address.

### 7.2 Seat a placement officer on the demo campus

Run this from your laptop, against Neon. The ops commands need the master key so the mailbox hash matches the officer's sign-in. `HIRELANE_OPS_ACTOR` records your name in the audit log.

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; cd /Users/aagarwal/hirelane && CAMPUS_ID="$(docker exec -e NEON_URL="$NEON_DATABASE_URL" hirelane-postgres sh -c 'psql "$NEON_URL" -At -c "select id from campuses"')" && echo "campus $CAMPUS_ID" && DATABASE_URL="$NEON_DATABASE_URL" HIRELANE_OPS_ALLOW_REMOTE=1 HIRELANE_OPS_ACTOR=YOUR-NAME pnpm ops owner-invite --campus "$CAMPUS_ID" --email OFFICER-ADDRESS )
```

Replace `YOUR-NAME` and `OFFICER-ADDRESS`. Expected: `owner invite issued: member=... (14 days; claimed when the person signs in ...)`. The invite has no domain check, so any officer address works. It lasts 14 days.

The officer then opens `https://DEMO_HOST/signin`, signs in with Google using that address, and opens `/campus`. The seat is claimed when the app calls the claim endpoint after sign-in.

### 7.3 Students join with the join code

A student signs in with Google and joins by code on `/welcome/college`, using `DEMO_JOIN_CODE`. The code join does not check the email domain. Students then see Home, Picks, Tracker and Drives.

## 8. Smoke test and manual checklist

### 8.1 Automated smoke test (GET only, no login)

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; cd /Users/aagarwal/hirelane && bash scripts/demo-smoke.sh "https://$DEMO_HOST" )
```

After you turn sign-in on, add the sign-in checks:

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; cd /Users/aagarwal/hirelane && SMOKE_ACCOUNTS=1 bash scripts/demo-smoke.sh "https://$DEMO_HOST" )
```

Expected: a final line `demo smoke: N passed, 0 failed` and exit code 0. A job page is checked only when the public feed has a job. It is shown as SKIP otherwise.

### 8.2 Manual checklist (desktop, then a 390 px phone)

- Landing page loads without console errors.
- `/jobs` shows jobs (empty until the first ingest; see 6.5).
- The officer console at `/campus` shows Demo Institute of Technology (sample), 24 students, 2 drives and 8 outcomes.
- A student joins with the code, opens Home, and right-swipes a job. The swipe creates a fixture application only.
- Signed-in pages open without a `permission denied` error (section 0, row 8). If one appears, stop and report it.
- `/dev/ui` and `/dev/campus` return 404.
- No model calls were made. Run this and expect `0`:

```sh
( set -a; . "$HOME/hirelane-demo.env"; set +a; docker exec -e NEON_URL="$NEON_DATABASE_URL" hirelane-postgres sh -c 'psql "$NEON_URL" -At -c "select count(*) from llm_calls"' )
```

## 9. Rollback and kill switches

| Need | Do this |
| --- | --- |
| Stop automatic applications now | Set `HIRELANE_AUTO_APPLY=off` in Vercel (Production) and redeploy. |
| Stop the worker | `( set -a; . "$HOME/hirelane-demo.env"; set +a; fly scale count 0 -a "$FLY_APP" )`. Start again with the same command and `count 1`. |
| Close sign-in | Set `HIRELANE_ACCOUNTS=0` in Vercel and redeploy. |
| Roll back the web app | Vercel, Deployments: choose the last good deployment, then Promote to Production (instant rollback). Re-run section 8. |
| Roll back the worker | `fly releases -a "$FLY_APP"` shows previous images. Then `fly deploy -a "$FLY_APP" --image IMAGE-REF`. |
| Roll back the database | Migrations are forward-only and checksum-locked: the migrator refuses an edited file. Restore the `before-migrate` Neon branch, or add a new migration. |
| Reset the demo data | Create a new Neon branch and repeat sections 3.3 to 3.4 into it. |
| Take the demo down | Remove the domain in Vercel and run `fly scale count 0`. |

Never rotate `HIRELANE_MASTER_KEY` as a rollback step. Stored data and the join-code hashes depend on it.

## 10. Decisions and gaps that remain after tomorrow

1. Resume upload. Options: keep it off for the demo (the current plan), host the web app on Fly next to the worker with a shared volume (the `[[mounts]]` block in the template), or build a shared blob store. Nothing here implements the last option.
2. Mail transport (Amazon SES). Email sign-in, the email college join, and notifications all depend on it.
3. Inbound employer mail. This needs an MX record and an authserv id for the receiving server. Auto-apply is fixture-only, so nothing reaches employers.
4. A remote-safe seed command. It would need a deliberate change to the guard and its tests. It was not done here, and no test was weakened.
5. Live ingest and live auto-apply stay off. The owner decision of 2026-10-29 allows a supervised pilot only.
