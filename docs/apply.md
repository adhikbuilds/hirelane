# Apply (right swipe = applied)

**Status:** built, uncommitted, 2026-10-31. **Fixture only.** Nothing is sent to a real employer: there is no live ATS transport, and the executor refuses every host that is not a fixture host.

**Owner decision (2026-10-29, `docs/product/DECISIONS-2026-10-29-night.md`):** a right swipe means the student has applied. Hirelane may submit on the company's own form, but only:

- with the student's `auto_apply` consent, which they can switch off at any time
- never past a CAPTCHA, bot check or login. A blocked attempt falls back to "finish on their site"
- never with invented answers
- with receipts, a per-platform kill switch and a daily cap
- against recorded fixtures only, until the owner runs a supervised live pilot

**Sources:**

- Services: `packages/services/src/apply/` (`swipe.ts`, `consent.ts`, `address.ts`, `tracker.ts`, `inbox.ts`, `answers.ts`, `inputs.ts`, `views.ts`).
- Worker: `workers/runner/src/tasks/apply-submit.ts` (`apply:submit`, `apply:sweep`), `apply-common.ts` (claim, cap, sweep, the repo), `inbound-scan.ts`, `inbound-classify.ts`, `inbound-mime.ts` (`inbound:scan`).
- Executor: `packages/agent/src/submit/` (`execute.ts`, `transport.ts`, `challenge.ts`, `forms.ts`, `payload.ts`, `types.ts`). Global switch: `packages/agent/src/apply-mode.ts`.
- Answers: `docs/answers.md`.
- Schema: `packages/db/migrations/0012_apply_pipeline.sql`, `0012a_apply_fixes.sql`, `0013a_apply_audit.sql`.
- HTTP: `/api/v1/apply/*`, see `docs/public-api.md` §14.8.
- Crontab: `*/5 * * * * apply:sweep` (`workers/runner/crontab`).

---

## 1. What a right swipe does

`swipeRight` runs in one transaction:

1. Checks the global switch (below). With the switch `off`, it refuses with `503 auto_apply_off` and creates nothing.
2. Creates the student's apply address if it does not exist yet (§7).
3. Picks the resume: the one named, or the default. A purged or deleted resume is `404`.
4. Creates the application with status `ready` and a 4 second undo window. The database sets the window, not the caller.
5. Queues `apply:submit` with the job key `apply:submit:<id>`, after the commit.

The response returns the application, the apply address and `autoApply` (the consent state). **A swipe does not need consent.** The worker decides what is sent, so a swipe without consent still creates an application, which is then blocked with `no_consent`.

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
4. **Resume clearance.** A resume that carries sensitive kinds (Aadhaar, PAN and similar) is never sent (`sensitive_resume`). Purpose limitation: the consent covers the resume, not what is inside it.
5. **The form** (`GET` on the apply URL). A CAPTCHA, bot check, challenge or login wall ends the attempt here (`captcha`, `challenge`, `login`). No solving, waiting, evasion or account creation. 404 or 410 is `form_not_found`. Other non-2xx is `http_<code>`. An unreadable form is `unsupported_form`.
6. **Answers** (§ `docs/answers.md`). Each field needs a value, evidence and a valid format. Any `needs_you` answer on a required field blocks the attempt (`needs_you`).
7. **Submit** (`POST` to `<apply URL>/submit`, multipart). A block marker in the reply is a wall. 2xx is `submitted` (`accepted`). 429 is `rate_limited`. Other codes are `failed`.
8. **Receipt.** Written in the same transaction as the outcome.

The default transport is a fixture employer behind a guard. Its hosts end in `.fixture.invalid`, which can never resolve. Any other host is refused, and a refused host is `live_disabled`. Fixture scenarios are `ok`, `captcha`, `login`, `captcha-submit`, `reject` and `missing`.

## 4. Daily cap and reschedule

- The cap is `apply_addresses.daily_cap`, default **20**, allowed 1 to 200.
- The count is per student, per **local day**. The day uses the student's profile timezone if it is a valid IANA name, else `Asia/Kolkata`.
- It counts claims in `submitting`, `submitted` or `failed` since local midnight. Blocked and ready applications do not count.
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
- **There is no ops CLI or script for it.** See the open list.

## 7. Apply address

- Format: `<handle>@<domain>`. The handle is the student's first two name words, letters and digits only, joined with a dot, plus a 3-character tag (for example `rohan.mehta.k3x`).
- The domain is `HIRELANE_APPLY_DOMAIN`. In production it must be a real domain, not a `localhost` name. Otherwise the default is `apply.hirelane.localhost`.
- The address is created once, on the first swipe or the first time auto-apply is turned on, and kept for good.
- Each address also has a 12-character `reply_handle`, which the inbound scanner uses (§8).
- **The form gets the apply address as the email.** The student's own mailbox is never sent to an employer (the test "the form gets the Hirelane apply address" checks this for all three platforms).

**Found while writing this doc (not on the owner list):** the scanner accepts only mail sent to `handle+<reply_handle>@domain`. The address handed out, both to the form and in the API, is `handle@domain`, with no tag. The test `inbound-scan` quarantines a bare-handle message (`bare.eml`). As the code stands, an employer reply to the address on the form would be quarantined and never reach the student. This must be fixed before a pilot: either hand out the tagged address, or accept the bare handle. See the open list.

## 8. Employer mail (`inbound:scan`)

`inbound:scan` reads `*.eml` files from `HIRELANE_MAIL_INBOX` (default `<repo>/.mail/inbox`). This is a **fixture mailbox**. There is no live MX, webhook or mail transport yet.

For each file, in order:

1. **Envelope recipient.** It must be `handle+<reply_handle>@domain` for a known apply address. Anything else is skipped and quarantined. The tag must match. The bare handle is not accepted.
2. **Authentication.** The topmost `Authentication-Results` header must carry the authserv-id `HIRELANE_MAIL_AUTHSERV_ID`, and must report `dmarc=pass` for a From domain that is aligned. Otherwise the message is quarantined as `unauthenticated` and is never stored or forwarded. A header written by any other server, or by the sender, is ignored.
3. **Application match.** The sender's domain is matched first, then the company name. The job title breaks ties. A message that matches no application is still stored, with `matched_by = none`.
4. **Kind.** `inbound-classify` decides `interview`, `test`, `rejection` or `other`, with rules only. It reads only the sender's own words: quoted history and the signature are removed first, and a rejection beats an interview mention.
5. **Store and notify.** The subject and an excerpt are sealed. One in-app `notifications` row is written in the same transaction.
6. **Forward.** The message goes to the student's own address through the file outbox (`.mail/outbox`). `forwarded_at` is set. A stored but unforwarded message is forwarded on the next scan.

It is idempotent per Message-ID for each student. Logs carry counts only, never addresses, subjects or bodies.

**Scheduling:** `inbound:scan` is registered as a task, but it has **no crontab entry, no package script, and nothing in the code enqueues it**. It runs only when someone queues it by hand. See the open list.

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

`failStuck` moves a `submitting` row older than 15 minutes to `failed` with reason `stuck`. It writes **no receipt, no answers and no `sent` flag**. If the worker died after the request had left the process, the record says `failed` and gives no sign that the employer may have received it. A fix needs to record "outcome unknown" and ask the student to check, instead of "failed".

## 11. Tests

- `packages/services/test/apply.test.ts`, `packages/db/test/apply.test.ts` and `packages/db/test/apply-helpers.ts` (the states and the triggers).
- `apps/web/tests/apply-api.test.ts`, `apps/web/tests/api-v1-parity.test.ts` (every action has a v1 route).
- `workers/runner/test/apply-submit.test.ts`, `workers/runner/test/inbound-scan.test.ts`, `workers/runner/test/inbound-hardening.test.ts`, `workers/runner/test/inbound-corpus.test.ts`.
- `packages/agent/src/submit/execute.test.ts`, `packages/agent/src/submit/forms.test.ts`.

---

## Open before pilot

These are the owner items, in the order the owner listed them. Each one blocks a supervised pilot until it is decided or closed.

1. **Template free text is still auto-submitted.** `why_role` and `about_yourself` are filled from a template and sent without the student seeing them (`docs/answers.md` §5 and §6). `why_company` is held back only because the worker passes no company line. Decide whether templated text may ever be sent unseen.
2. **There is no live ATS transport.** `live` behaves as `fixture`. The default transport refuses every non-fixture host. No real form has been tried.
3. **The `cgpa-rules.json` rows are all `verified: false`.** All 28 rows were entered from memory. None has a fetched check. Until a student or campus confirms a row, it is used 0 times (`pnpm engine:eval`: 28 of 28 unknown without a rule).
4. **E5 (the university rule) is not wired.** The engine accepts `universityRule`, but no caller passes it: the drive inbox, the nightly drive counts and the apply answers pass only the campus rule (`docs/eligibility.md` §5, `docs/campus.md` §9).
5. **There is no picks service or ops CLI for the pilot.** `packages/services/src` has no picks module, and no v1 picks route exists. Changing a kill switch, a daily cap or a consent for an operator needs direct SQL.
6. **The roster-import role is undecided.** Today `tpo_import_roster` has no owner check, so any staff seat on the campus can import (`docs/campus.md` §4).
7. **Noise vs rounding is undecided.** The TPO numbers use k = 10, complementary suppression and rounding to 5. Whether to add noise is open (`docs/campus.md` §3).
8. **GET routes write rows.** Every `/api/v1/tpo/*` GET runs the invite claim. The outcome list, the letter view and the NAAC export also write `tpo_access_log` rows (`docs/campus.md` §8). Decide whether reads should stay side-effect free.
9. **Join-screen wording.** The copy for the join screen is not decided.
10. **MTA `Authentication-Results` stripping.** The DMARC check trusts only the headers that carry `HIRELANE_MAIL_AUTHSERV_ID`. The receiving MTA must strip any inbound header with that authserv-id, so a sender cannot forge one. This is not configured or documented in ops yet.
11. **Resolved in the working tree, pending owner review: `removeStaff`, `transferOwnership`, `rearmApplication` and `markFinishedByStudent` had no HTTP route.** The routes now exist: `DELETE /api/v1/tpo/staff/{id}`, `POST /api/v1/tpo/staff/{id}/transfer-ownership`, `POST /api/v1/apply/applications/{id}/rearm` and `POST /api/v1/apply/applications/{id}/finish` (`docs/public-api.md` §14.7 and §14.8). Keep this line until the owner has reviewed the four routes.
12. **The `failStuck` blind spot.** A stuck claim is recorded as `failed`, with no receipt (§10).

**Found while writing this doc (not on the owner list):**

13. **Apply address tag mismatch** (§7). Employers are given `handle@domain`, but the scanner accepts only `handle+reply_handle@domain`, so a reply to the address on the form is quarantined.
14. **Nothing schedules or enqueues `inbound:scan`** (§8). With no cron entry, script or caller, the employer-mail path does not run in any environment.
15. **The worker passes an empty company line** (`docs/answers.md` §5). `why_company` is therefore always `needs_you` on the auto path, which may be what the owner wants, but it is not a decision anyone has recorded.

## Related

- `docs/answers.md`: how each answer is filled, and the classifier traps.
- `docs/campus.md`: the campus side and the drive counts.
- `docs/eligibility.md`: the profile and CGPA rules behind the answers.
- `docs/public-api.md` §14: the v1 routes.
- `docs/product/DECISIONS-2026-10-29-night.md`: the owner decisions.
