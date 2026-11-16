# Ops CLI (`pnpm ops`)

**Status:** built, uncommitted, 2026-11-01. Five commands and their audit rows are in the working tree, and `pnpm ops` prints the usage. Operators run it by hand, against the owner role. It is not part of the app and not on any route.

**Sources:**

- Entry point: `scripts/ops/main.ts` (run by `vite-node`). Wiring: `scripts/ops/deps.ts` (the actor, the keyed hashes, the remote-database guard).
- Commands and validation: `packages/db/src/ops/index.ts` (`runOpsCli`, `USAGE`, one function per command). The database package may not import the vault, so the keyed hashes are passed in by the entry point.
- Audit table: `packages/db/migrations/0014_pilot_blockers.sql` (section 4, `ops_audit`).
- Root scripts: `package.json` (`ops`, and the shortcuts `ops:campus-create`, `ops:domain-add`, `ops:domain-remove`, `ops:cgpa-rule`, `ops:owner-invite`, `ops:platform-switch`).
- Tests: `packages/db/test/ops.test.ts` (database), `scripts/test/ops-deps.test.ts` (the wiring and the remote guard; run with `pnpm test:scripts`).

---

## 1. Before you run it

- **`DATABASE_URL`** must be set (the same variable as the app). The entry point reads it first, so it is needed even for `pnpm ops --help`. The command refuses to start without it.
- **A remote database** (not localhost) needs `HIRELANE_OPS_ALLOW_REMOTE=1`. Without it the command exits before doing anything. Help is exempt from this check.
- **`HIRELANE_OPS_ACTOR`** sets who is recorded on every audit row. Without it, the OS user name is used.
- **`HIRELANE_MASTER_KEY`** is needed by `campus create` (the join code is hashed) and `owner-invite` (the address is hashed). It is read on first use. Dev: `pnpm setup:keys` (`docs/architecture.md` §5).
- Every command runs as the owner role, through `withAdmin`. The app role cannot write `ops_audit` and cannot change the platform switches.

## 2. Commands

```
pnpm ops <command> [flags]

  campus create --name <text> --domain <host> [--domain <host> ...] [--cgpa-a <n> --cgpa-b <n>]
  domain add    --campus <id> --domain <host>
  domain remove --campus <id> --domain <host>
  cgpa-rule set --campus <id> (--a <n> --b <n> | --clear)        pct = a * cgpa + b
  owner-invite  --campus <id> --email <address>
  switch set    --platform <greenhouse|lever|ashby> (--on | --off) [--reason <text>]
```

| Command | What it does | Audit `command` |
|---|---|---|
| `campus create` | Makes a campus with at least one college domain. Optional CGPA rule, given as both `--cgpa-a` and `--cgpa-b`. **Prints the campus id and the join code once. The code is not stored**; only its keyed hash is. | `campus_create` |
| `domain add` / `domain remove` | Adds or removes a college email domain. A student can only join by email from a registered domain (`docs/campus.md` §1). | `domain_add`, `domain_remove` |
| `cgpa-rule set` | Sets the campus CGPA-to-percentage rule (`pct = a × cgpa + b`), or `--clear` removes it. `a` is 0.5 to 20 and `b` is -50 to 50. Only the campus rule is used by the engine today (`docs/eligibility.md` §5). | `cgpa_rule_set` |
| `owner-invite` | Invites an owner by email. The seat lasts **14 days**. If an unclaimed, expired invite exists for that address, it is re-issued. The invitee claims it by signing in with a verified account email and calling `POST /api/v1/tpo/claim`. | `owner_invite` |
| `switch set` | Turns a platform's auto-apply kill switch on or off, with an optional reason of up to 300 characters. **Never creates a row:** a missing row is `not_found`, because a missing row fails closed (`docs/apply.md` §6). | `platform_switch` |

### Refusals

- `owner-invite` refuses if that address already holds a seat on the campus (`conflict`), or if an invite for it is already open (`conflict`).
- A campus that does not exist is `not_found`. A bad domain, id, email, rule or platform is `invalid`.
- Missing or contradictory flags are `usage`, and the usage text is printed.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done (or help) |
| 1 | Refused or failed. The reason is printed as `error: …`. An unexpected failure prints `error: unexpected failure` and no detail. |
| 2 | Usage error. The usage text is printed. |

### Shortcuts

The root `package.json` has six `ops:*` scripts. Each sets the sub-command, so the flags follow:

```
pnpm ops:platform-switch --platform lever --off --reason "sudden form change"
pnpm ops:campus-create --name "Example College" --domain example.edu
```

## 3. The audit trail

- **One `ops_audit` row per command, written in the same transaction as the change.** Both commit or neither does.
- **Columns:** `at`, `actor`, `command` (one of the six names above), `target` (a campus id, a platform name or a member id), and `detail` (JSON).
- **What is in `detail`:** ids, the names of campuses and domains, the old and new setting, the kill switch's reason, and the expiry in days. An invite is recorded by **member id**, never by address.
- **What is never in it:** a join code, an address, or a keyed hash. The schema rejects an unknown command name.
- The app role has no access to `ops_audit`.

## 4. What the CLI does not cover

These still need direct SQL, or a route (`docs/apply.md` open list, item 11):

- a student's daily auto-apply cap (`apply_addresses.daily_cap`), and their auto-apply consent;
- anything a placement cell does day to day: drives, roster import, outcome verification, and removing or moving staff. Those are done by staff through the console and the API (`docs/public-api.md` §14.7).

## 5. Related

- `docs/campus.md` §1 (joining by code and by email), §6 (the staff lifecycle).
- `docs/apply.md` §6 (the kill switch).
- `docs/architecture.md` §5 (`HIRELANE_OPS_*` and the master key).
