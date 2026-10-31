# Apply (right swipe = applied)

**Status:** built, uncommitted, updated 2026-11-01 (integrate pass: `pnpm verify` exit 0 after `pnpm db:migrate` applied 0016; `next build` not run). **Fixture only.** Nothing is sent to a real employer: there is no live ATS transport, and the executor refuses every host that is not a fixture host.

**Owner decision (2026-10-29, `docs/product/DECISIONS-2026-10-29-night.md`):** a right swipe means the student has applied. Hirelane may submit on the company's own form, but only:

- with the student's `auto_apply` consent, which they can switch off at any time
- never past a CAPTCHA, bot check or login. A blocked attempt falls back to "finish on their site"
- never with invented answers
- with receipts, a per-platform kill switch and a daily cap
- only to hosts on the executor's allowlist (§3), and with a per-student limit of 20 swipes a minute
- against recorded fixtures only, until the owner runs a supervised live pilot

**Sources:**

- Services: `packages/services/src/apply/` (`swipe.ts`, `consent.ts`, `address.ts`, `tracker.ts`, `inbox.ts`, `answers.ts`, `aad.ts`, `inputs.ts`, `views.ts`).
- Shared address helper: `packages/agent/src/apply-address.ts` (`applyAddressOf`, §7).
- Worker: `workers/runner/src/tasks/apply-submit.ts` (`apply:submit`, `apply:sweep`), `apply-common.ts` (claim, cap, sweep, the repo), `inbound-scan.ts`, `inbound-classify.ts`, `inbound-mime.ts` (`inbound:scan`).
- Executor: `packages/agent/src/submit/` (`execute.ts`, `transport.ts`, `allowlist.ts`, `challenge.ts`, `forms.ts`, `payload.ts`, `types.ts`). Global switch: `packages/agent/src/apply-mode.ts`.
- Answers: `docs/answers.md`.
- Schema: `packages/db/migrations/0012_apply_pipeline.sql`, `0012a_apply_fixes.sql`, `0013a_apply_audit.sql`, `0014_pilot_blockers.sql` (draft suggestions, `ops_audit`), `0016_review_fixes.sql` (resume guard, waitlist erasure).
- HTTP: `/api/v1/apply/*`, see `docs/public-api.md` §14.8.
- Operator commands: `docs/ops.md` (`pnpm ops switch set`).
- Crontab: `*/5 * * * * apply:sweep` and `*/5 * * * * inbound:scan` (`workers/runner/crontab`).

---

## 1. What a right swipe does

`swipeRight` runs in one transaction:

1. Checks the global switch (below). With the switch `off`, it refuses with `503 auto_apply_off` and creates nothing.
2. Creates the student's apply address if it does not exist yet (§7).
3. Picks the resume: the one named, or the default. A purged or deleted resume is `404`.
4. Creates the application with status `ready` and a 4 second undo window. The database sets the window, not the caller.
5. Queues `apply:submit` with the job key `apply:submit:<id>`, after the commit.

The response returns the application, the apply address (`handle+tag@domain`) and `autoApply` (the consent state). **A swipe does not need consent.** The worker decides what is sent, so a swipe without consent still creates an application, which is then blocked with `no_consent`.

- Swiping again on an application already in progress changes nothing.
- Swiping again after an undo reopens the window.
- The job must be open and must have an apply target. Otherwise `409 job_closed` or `409 job_not_applicable`.

**Undo** is allowed only while the application is `ready` and the window is open (`409 undo_window_closed` after that). The database decides in one statement, so an undo racing the worker's claim has one winner.

### The global switch: `HIRELANE_AUTO_APPLY`

| Value | Meaning |
|---|---|
| unset in production | `off` |
| unset elsewhere | `fixture` |
| `off` | Nothing is created or queued. The worker leaves ready applications alone. |
| `fixture` | The executor runs against the fixture transport only. |
| `live` | Reserved. It behaves as `fixture` today, because the host guard refuses every real host. |

Any unknown value is `off`. When the switch is not `off`, a production worker will not start without a real `HIRELANE_APPLY_DOMAIN` (`assertApplyDomain`). Production also needs `HIRELANE_MAIL_AUTHSERV_ID` (§8).

## 2. States

| From | To | Who | When |
|---|---|---|---|
| (new) | `ready` | app | Swipe. Window of 4 seconds. |
| `ready` | `undone` | app | Undo inside the window. |
| `undone` | `ready` | app | Swipe again. New 4 second window. |
| `ready` | `submitting` | worker | Claim, only after the window has closed. One claim at a time per student (advisory lock). |
| `submitting` | `submitted` | worker | The employer accepted the submission. |
| `submitting` | `blocked_fallback` | worker | Consent, cap, kill switch, sensitive resume, a wall (CAPTCHA, challenge or login), an unsupported form, or a missing answer. |
| `submitting` | `failed` | worker | HTTP error, form not found, transport error, rate limit, or an internal error. |
| `submitting` | `ready` | worker | Over the daily cap. Put back for the student's next local midnight. |
| `blocked_fallback` (reason `needs_you`) | `ready` | app | `rearm`, after the student answers the question. New window. |
| `blocked_fallback` | `submitted` | app | `finish`: the student finished on the employer's site. `manual_finish = true`. Nothing was sent by Hirelane. |
| `submitting` | `failed` (reason `stuck`) | sweep | A claim older than 15 minutes with no finish. See §10. |

Any other move is an error in the database (`applications_transition`). The application's identity (user, job, platform and apply URL) cannot change.

**Sweep** (every 5 minutes): re-queues `ready` applications whose window closed more than a minute ago, because their submit job may have been lost. It fails `submitting` rows older than 15 minutes.

**Claim timing:** a claim before the window closes is re-queued for the window end plus 250 ms.

## 3. The executor

`runSubmit` checks, in this order. Each failed check ends the attempt in `blocked_fallback` or `failed`, with a code:

1. **Consent.** The latest `auto_apply` consent row must be granted. No row means no consent.
2. **Daily cap** (the executor's own guard; the worker checks it first and reschedules, see §4).
3. **Kill switch.** The platform's row in `platform_switches` must be enabled.
4. **Resume clearance.** Sensitive kinds (Aadhaar, PAN and similar) are read through the **root** resume: the row's own value, or the root's when the row is a version (`COALESCE` of the two). The root must also be live (not deleted and not purged). A resume that carries any sensitive kind is never sent. A confirmed version whose root carries `pan` ends as `blocked_fallback` with reason `sensitive_resume`. Purpose limitation: the consent covers the resume, not what is inside it.
5. **The form** (`GET` on the apply URL). **First, the apply-host allowlist** (`allowlist.ts`): the apply URL must be `https`, with no credentials, IP literal or port, on a host in `SubmitOptions.allowedHosts` (default: `*.fixture.invalid` only). Otherwise the attempt ends as `host_not_allowed` before any transport call. A CAPTCHA, bot check, challenge or login wall ends the attempt here (`captcha`, `challenge`, `login`). No solving, waiting, evasion or account creation. 404 or 410 is `form_not_found`. Other non-2xx is `http_<code>`. An unreadable form is `unsupported_form`.
6. **Answers** (§ `docs/answers.md`). Each field needs a value, evidence and a valid format. Prose the engine composed (free-text keys, or evidence from the company line) is held as `needs_you` with reason `confirm_draft`, and the draft is kept as a suggestion. The suggestion is sealed in `application_answers.suggestion_enc`, and only a `needs_you` row can carry one. Any `needs_you` answer blocks the attempt (`needs_you`). The student's own saved answer from the answer bank is still sent.
7. **Submit** (`POST` to `<apply URL>/submit`, multipart). A block marker in the reply is a wall. 2xx is `submitted` (`accepted`). 429 is `rate_limited`. Other codes are `failed`.
8. **Receipt.** Written in the same transaction as the outcome.

The default transport is a fixture employer behind a guard. Its hosts end in `.fixture.invalid`, which can never resolve. Any other host is refused, and a refused host is `live_disabled`. Fixture scenarios are `ok`, `captcha`, `login`, `captcha-submit`, `reject` and `missing`.

## 4. Daily cap and reschedule

- The cap is `apply_addresses.daily_cap`, default **20**, allowed 1 to 200.
- The count is per student, per **local day**. The day uses the student's profile timezone if it is a valid IANA name, else `Asia/Kolkata`.
- It counts claims in `submitting`, `submitted`, `failed` or `blocked_fallback` since local midnight. **A blocked attempt counts** (decision 2026-10-31; it used to be free). Ready applications do not count, and a re-armed application is counted again only when it is claimed again.
- The claim takes an advisory lock per student, so two claims cannot race past the cap.
- Over the cap, the worker puts the application back to `ready` and moves its window to the next local midnight, then re-queues it. Nothing is lost.

## 5. Consent

- Consents are append-only. The row is `kind = 'auto_apply'`, with doc version `auto-apply-2026-10-29`. The database stamps the time.
- Switching on creates the apply address (§7). Switching off writes a `granted = false` row.
- Nothing is sent without a granted row, whatever the switch says.

## 6. Kill switch

- `platform_switches` has one row per platform (`greenhouse`, `lever`, `ashby`). All three are enabled by the migration.
- A missing row fails closed: no submission.
- The app role has no access to the table. Changing a switch needs the owner role.
- **Ops CLI:** `pnpm ops switch set --platform lever --off --reason "..."` (or `--on`). It never creates a row, and writes an `ops_audit` row with the old and new value. All commands, and the environment they need, are in `docs/ops.md`.

## 7. Apply address

- **The address handed out is `handle+reply_handle@domain`**, lower-cased, built by one helper (`applyAddressOf` in `packages/agent/src/apply-address.ts`). The form payload, the services API (the swipe response, the consent state, the application record) and the answer record all use it.
- The handle is the student's first two name words, letters and digits only, joined with a dot, plus a 3-character tag (for example `rohan.mehta.k3x`). The `reply_handle` is a 12-character opaque tag from `[a-z0-9]`.
- The domain is `HIRELANE_APPLY_DOMAIN`. In production it must be a real domain, not a `localhost` name. Elsewhere, when it is unset, the default is `apply.hirelane.localhost` (`.env.example` sets `apply.localhost`).
- The address is created once, on the first swipe or the first time auto-apply is turned on, and kept for good.
- **The form gets the apply address as the email.** The student's own mailbox is never sent to an employer (the test "the form gets the Hirelane apply address" checks this for all three platforms). A test checks that the address in the payload parses to the tag `inbound:scan` accepts.
- A bare-handle address (`handle@domain`) is never handed out. Earlier builds did hand it out, and the scanner quarantined replies to it. That is fixed (§8, closed items).

## 8. Employer mail (`inbound:scan`)

`inbound:scan` reads `*.eml` files from `HIRELANE_MAIL_INBOX` (default `<repo>/.mail/inbox`). It is on the crontab every 5 minutes (a missing folder is not an error). This is a **fixture mailbox**: there is no live MX, webhook or mail transport yet.

For each file, in order:

1. **Envelope recipient.** It must be `handle+<reply_handle>@domain` for a known apply address. Anything else is skipped and quarantined. The tag must match. The bare handle is not accepted.
2. **Authentication.** The topmost `Authentication-Results` header must carry the authserv-id `HIRELANE_MAIL_AUTHSERV_ID`, and must report `dmarc=pass` for a From domain that is aligned. Otherwise the message is quarantined as `unauthenticated` and is never stored or forwarded. A header written by any other server, or by the sender, is ignored.
3. **Application match.** The sender's domain is matched first, then the company name. The job title breaks ties. A message that matches no application is still stored, with `matched_by = none`.
4. **Kind.** `inbound-classify` decides `interview`, `test`, `rejection` or `other`, with rules only. It reads only the sender's own words: quoted history and the signature are removed first, and a rejection beats an interview mention.
5. **Store and notify.** The subject and an excerpt are sealed. One in-app `notifications` row of kind `employer_message` is written in the same transaction (see the note below).
6. **Forward.** The message goes to the student's own address through the file outbox (`.mail/outbox`). `forwarded_at` is set. A stored but unforwarded message is forwarded on the next scan.

It is idempotent per Message-ID for each student. Logs carry counts only, never addresses, subjects or bodies.

**Note on the notification kind.** The `employer_reply` kind (an email through the notification sweep, `docs/notifications.md`) has its service and tests, but `inbound:scan` does not call it. An employer reply today becomes an `employer_message` Home row, and the email is the forward in step 6. The student's Home screen does not yet list notification rows (`docs/notifications.md` §6). See the open list, item 9.

**Production:** the authserv-id is required (`HIRELANE_MAIL_AUTHSERV_ID`, and it must not be a localhost name). The receiving MTA must strip any inbound `Authentication-Results` that carries that id (open list, item 6).

The reader (`inbound-mime.ts`) caps sizes and depth, never fetches or executes anything, and never throws on bad input. Attachments are ignored.

## 9. Student-facing reads

| Route | What it shows |
|---|---|
| `GET /api/v1/apply/applications` | The tracker, newest first, optionally by status. |
| `GET /api/v1/apply/applications/{id}` | One application: answers (with `needs_you` and the reason), the receipt, the apply address and matched employer messages. |
| `POST .../undo`, `POST .../rearm`, `POST .../finish` | The student's three moves (§2). |
| `GET` and `PUT /api/v1/apply/inbox` | Employer messages forwarded to the student, and mark all read. |
| `GET`, `PUT`, `DELETE /api/v1/apply/answers` | The answer bank. |
| `GET` and `PUT /api/v1/apply/consent` | The consent state and the apply address. |

A `fallback` link is returned only for `https://` apply URLs.

**Receipts.** One per application, replaced by the next attempt. Each holds the answers hash (SHA-256 of the application id and the sorted answer pairs), the resume id and version, the platform, a result code, `sent` (true only when we sent the request), and the HTTP status. A blocked attempt is `sent: false`. Logs carry ids and result codes only.

## 10. The stuck-claim blind spot

`failStuck` moves a `submitting` row older than 15 minutes to `failed` with reason `stuck`. It writes **no receipt, no answers and no `sent` flag**. If the worker died after the request had left the process, the record says `failed` and gives no sign that the employer may have received it. A fix needs to record "outcome unknown" and ask the student to check, instead of "failed" (open list, item 8).

## 11. Tests

- `packages/services/test/apply.test.ts`, `packages/db/test/apply.test.ts` and `packages/db/test/apply-helpers.ts` (the states and the triggers).
- `packages/db/test/pilot-blockers.test.ts` and `packages/db/test/review-fixes.test.ts` (the draft suggestion, the TPO write gate, the resume guard trigger, waitlist erasure).
- `packages/agent/test/apply-address.test.ts` (the one address shape, and that `inbound:scan` accepts it).
- `apps/web/tests/apply-api.test.ts`, `apps/web/tests/api-v1-parity.test.ts` (every action has a v1 route).
- `workers/runner/test/apply-submit.test.ts` (including the sensitive-root gate), `workers/runner/test/inbound-scan.test.ts`, `workers/runner/test/inbound-hardening.test.ts`, `workers/runner/test/inbound-corpus.test.ts`.
- `packages/agent/src/submit/execute.test.ts`, `packages/agent/src/submit/forms.test.ts`.

---

## Open before pilot

These are the owner items and the findings still open, in the order they were listed. Each one blocks a supervised pilot until it is decided or closed. The closed items are in the next section.

1. **There is no live ATS transport.** `live` behaves as `fixture`. The default transport refuses every non-fixture host. No real form has been tried.
2. **The `cgpa-rules.json` rows are all `verified: false`.** All 28 rows were entered from memory, and none has a fetched check. Until a student or campus confirms a row, it is used 0 times (`pnpm engine:eval`: 28 of 28 unknown without a rule). The recon of 2026-10-31 (`docs/recon/cgpa-naac-sources-2026-10-31.md`) says the `vtu`, `aktu` and `mumbai` rows look wrong or disputed. The rows have not been changed yet.
3. **E5 (the university rule) is not wired.** The engine accepts `universityRule`, but no caller passes it: the drive inbox, the nightly drive counts and the apply answers pass only the campus rule (`docs/eligibility.md` §5, `docs/campus.md` §9).
4. **Noise vs rounding is undecided.** The TPO numbers use k = 10, complementary suppression and rounding to 5. Whether to add noise is open (`docs/campus.md` §3).
5. **Join-screen wording.** The copy for the join screen is not decided.
6. **MTA `Authentication-Results` stripping.** The DMARC check trusts only the headers that carry `HIRELANE_MAIL_AUTHSERV_ID`. The receiving MTA must strip any inbound header with that authserv-id, so a sender cannot forge one. This is not configured or documented in ops yet.
7. **No production mail transport.** `createMailer` throws at construction in production unless a real transport is injected. Email sign-in, campus mail, inbound forwarding and `notify:sweep` all need one. The file outbox is the only transport.
8. **The `failStuck` blind spot.** A stuck claim is recorded as `failed`, with no receipt (§10).
9. **Employer replies do not use the `employer_reply` kind** (§8). `inbound:scan` writes `employer_message`, and the notification sweep does not email that kind.
10. **The worker passes an empty company line** (`docs/answers.md` §5). `why_company` is therefore always `needs_you` on the auto path, which may be what the owner wants, but it is not a decision anyone has recorded.
11. **Operator daily cap and consent still need direct SQL.** `pnpm ops` covers campuses, domains, the CGPA rule, owner invites and platform switches. It does not cover a student's daily cap or consent (`docs/ops.md`).
12. **Resolved in the working tree, pending owner review: `removeStaff`, `transferOwnership`, `rearmApplication` and `markFinishedByStudent` had no HTTP route.** The routes now exist: `DELETE /api/v1/tpo/staff/{id}`, `POST /api/v1/tpo/staff/{id}/transfer-ownership`, `POST /api/v1/apply/applications/{id}/rearm` and `POST /api/v1/apply/applications/{id}/finish` (`docs/public-api.md` §14.7 and §14.8). Keep this line until the owner has reviewed the four routes.

## Closed

**Closed 2026-10-31 (owner list):**

- **Template free text is never auto-submitted.** `why_company`, `why_role`, `about_yourself` and any answer whose evidence is the company line are returned as `needs_you` (reason `confirm_draft`) with the draft as a sealed `suggestion` the student confirms or edits. Their own saved answer (answer bank) is still sent. Structured facts (name, email, marks, notice period) still auto-fill. See `docs/answers.md` §3 and §6.
- **Ops CLI.** `pnpm ops` (§6, `docs/ops.md`). Each command writes an `ops_audit` row in the same transaction.
- **Roster import and drive publishing are owner-or-officer only**, with no viewer role (`docs/campus.md` §4).
- **GET routes write nothing.** The invite claim, the named outcome list, the letter view and the NAAC file are explicit POST actions that keep writing the student's access log (`docs/campus.md` §8).

**Closed 2026-11-01 (integrate pass):**

- **Sensitive-data gate (high).** The worker reads `sensitive_kinds` and `parse_status` through the root resume and requires the root to be live (§3, step 4).
- **Reply address (high).** One helper, `applyAddressOf`, builds the tagged address for the form, the API and the answer record (§7). `inbound:scan` is on the crontab (§8). The earlier "apply address tag mismatch" and "nothing schedules `inbound:scan`" findings are closed by this.
- **Dev-only infrastructure (high).** `createMailer` fails closed in production without a real transport. `localBlobStoreFromEnv` fails closed in production without an absolute `HIRELANE_STORAGE_DIR`, and outside production uses `<workspace root>/storage`, so web and runner share one folder. `.env.example` is updated.
- **Account erasure.** Erasure also deletes the waitlist row (`erase_waitlist`, migration 0016).
- **Housekeeping.** `housekeeping:sweep` (daily, 03:10 UTC) purges `otp_challenges`, `rate_limits` and `join_attempts`.
- **Resume guard.** Migration 0016 adds a trigger, so the app role cannot un-delete a resume, move `purge_after`, or change `parse_status` or `confirmed_at`.
- **Idempotency bodies are sealed** with the vault (AAD `idem:<user>:<key>`), not stored as plaintext jsonb.
- **Export.** `exportMe` includes applications with their opened answers and receipts, inbound messages (opened), notifications and preferences, apply address, outcomes (letter bytes left out), drive checks, cohort memberships and the college access log. A schema-walk test fails if a table with a user column is neither exported nor excluded with a written reason.
- **Mailbox normalisation (campus).** `normalizeMailbox` strips `+suffix`, so `a+1@` and `a+2@` are the same seat.
- **Unsubscribe and notifications.** `/unsubscribe` (GET shows a confirm button; POST unsubscribes) and `notify:sweep` (every 10 minutes). See `docs/notifications.md`.

## Related

- `docs/answers.md`: how each answer is filled, and the classifier traps.
- `docs/campus.md`: the campus side and the drive counts.
- `docs/eligibility.md`: the profile and CGPA rules behind the answers.
- `docs/notifications.md`: the Home rows, the emails and the unsubscribe link.
- `docs/ops.md`: the `pnpm ops` commands.
- `docs/picks.md`: the picks that a student swipes on, and the paste check.
- `docs/public-api.md` §14: the v1 routes.
- `docs/product/DECISIONS-2026-10-29-night.md`: the owner decisions.
