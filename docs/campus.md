# Campus (placement cell)

**Status:** built, uncommitted, 2026-10-31. Slice 4 (4a joins and share levels; 4b roster, drives, TPO console, outcomes and NAAC) in `docs/design/campus-build-plan.md`. The Slice 3 acceptance boxes in that file are not changed by this note.

**Sources:**

- Schema: `packages/db/migrations/0011_campus.sql`, `0011a_campus_functions.sql`, `0011b_campus_fixes.sql`, `0013_campus_audit.sql`, `0013b_campus_rule_bounds.sql`.
- Services: `packages/services/src/campus/` (`membership.ts`, `codes.ts`, `roster.ts`, `drives.ts`, `tpo.ts`, `outcomes.ts`, `naac.ts`, `csv.ts`, `mail.ts`, `rpc.ts`, `views.ts`, `inputs.ts`).
- Nightly job: `workers/runner/src/tasks/campus-stats.ts` (`campus:stats`, cron `20 2 * * *`, 02:20 UTC).
- HTTP: `/api/v1/campus/*` and `/api/v1/tpo/*`, see `docs/public-api.md` §14.
- Screens: `apps/web/app/campus/` (overview, drives, outcomes, settings, students) and `apps/web/app/(app)/drives/`.

**Who is who:**

- **Student:** joins a campus, chooses how much the placement cell may see, reports interviews and offers, and reads a drive inbox.
- **TPO (placement cell staff):** an `owner` or `staff` seat on one campus. A stranger, a student and staff of another campus all get the same 404 for a campus they do not staff.
- **Database:** every TPO number is read through `SECURITY DEFINER` functions. The raw counts table is revoked from the app role.

Verdicts follow the engine rules: only `fail` blocks anything, and a CGPA-to-percent comparison with no rule is `unknown` (see `docs/eligibility.md` §5).

---

## 1. Joining

Two ways in. Both end in one `cohort_members` row per person, with `verified_via` set to `code`, `email` or `roster`.

**By campus code.**

- 8 characters of Crockford base32, which is 40 bits. Typing is forgiving: case, spaces and hyphens are ignored, and I/L become 1 and O becomes 0.
- The code is hashed (purpose `campus/code`). The database never sees the plain code.
- Without a cohort the join returns the cohorts to choose from. With a cohort it joins.
- A code join is `verified_via = code` and `verified_at` is null. It **does not count toward k**, so a crowd sharing a code cannot inflate the numbers.
- Limits: 10 code attempts per user per 15 minutes, and 60 per IP per 15 minutes. A circuit breaker applies when 300 or more failed code attempts happen in one minute and the caller has 3 or more failures in 15 minutes.

**By college email.**

1. The address must be on a domain registered to a campus (`campus_domains`). Any other domain is `422 not_a_college_email`.
2. A six-digit code is mailed to that address. It expires in 10 minutes and takes 5 attempts at most.
3. The student enters the code. It must match the challenge the account was issued.
4. Limits: 5 sends per user per 15 minutes; 30 per IP per 15 minutes; one send per 60 seconds; 10 codes per (mailbox, account) per 24 hours; 40 codes per mailbox per 24 hours. Verification allows 12 tries per user per 15 minutes, 10 guesses per mailbox per user per hour, and 5 attempts per code.
5. The college email is stored only as a keyed hash (`email_hmac`). A proven mailbox that matches a roster row for the cohort joins as `roster`.

Errors are the same shape whether the code is wrong, expired or unknown (`invalid_code` 400). `mail_unavailable` (503) names neither the address nor the code.

## 2. Share levels

The student sets one level. Every change is written as an append-only `campus_share` consent, with `doc_version` `share-v1:<level>`.

| Level | What the placement cell can see | Default |
|---|---|---|
| `aggregate` | Counted in the cohort numbers only. Nothing per student. | Yes |
| `outcomes` | Also listed by name, with the outcomes the student reported or the TPO verified, and whether they are a verified member. No email. | |
| `full` | As `outcomes`, plus the student's college email. | |

- `interview_reported` and `offer_reported` count only members at `aggregate`. If members who share more were included, the aggregate could be subtracted from the named list.
- Leaving the campus (`DELETE /api/v1/campus/me`) removes the membership and records a `share-v1:left` consent.
- Every TPO read of a student's data (outcome list, NAAC export, letter view, verification) writes a `tpo_access_log` row. The student can read those rows at `GET /api/v1/campus/access-log`. The log does not show who read it.

## 3. k-anonymity and the numbers

Every number a TPO sees comes from the nightly snapshot (`cohort_stats_daily`), read through the `tpo_cohort_stats` function.

- **Verified members only.** Members who joined by code are left out.
- **k = 10.** A cell is hidden when its count is under 10, or when the rest of its population is under 10 (`P - n < 10`).
- **Complementary suppression.** When one cell of an exclusive group is hidden, the smallest other cell in that group is hidden too. This stops someone rebuilding the hidden cell as the total minus the others.
- **Rounded to the nearest 5.**
- **Latest day only.** The read functions return only the newest snapshot. There is no series to difference across days.
- **Fixed metrics.** Twelve named metrics (joined, the resume stages, the readability of the resume, the blockers such as an active backlog or a 60% cut-off, interviews, offers and placed). Callers pass no filters and no dimensions.
- **Retention.** Snapshots are kept 35 days. The raw counts table is revoked from the app role.

## 4. Roster staging

A TPO imports a cohort CSV so the placed flag and verification can be applied.

- **Input:** at most 1 MiB and 20,000 rows. The file needs an email column. A placed column is optional (`1`, `y`, `yes`, `t`, `true` or `placed` count as placed).
- **Node side:** each address is normalised and replaced by its keyed hash. The domain and the placed flag are kept. The plain addresses, the names, the roll numbers and the CSV text are dropped in the request. Nothing from the file reaches a log.
- **Database side:**
  - Only rows on a registered campus domain are kept.
  - Fewer than 10 valid rows is refused (`too_few_rows`, 400), so a small file cannot probe one student.
  - One import per cohort per 24 hours (`import_rate_limited`, 429).
  - The result carries counts only. There is no match count.
- **Staging:** an import only stages rows in `cohort_roster`. `campus_apply_roster()` runs at the start of the nightly `campus:stats` job, so verification and the placed flag change once a day.
- **Placed students:** the student can read their own placed flag (it drops them from picks). A placed flag that changed in the last 24 hours keeps the member out of drive populations.

**Open:** any staff seat can import today. The owner-only or any-staff decision is open (see `docs/apply.md`).

## 5. Drive caps and differencing

A TPO pastes a drive notice and publishes it to one cohort.

- **Parsing:** `parseCriteria` and `detectScamSignals` run on the notice text. This is rules only (0 LLM calls). The link is stored as text and is never fetched. A flagged drive is still published, and its flags travel with it.
- **Cap:** at most 10 drives per cohort in any 30 days. The 11th is refused with `429 drive_limit`. The cap is in the database, so it holds for every caller.
- **Verdicts:** the nightly job evaluates each non-placed member of the cohort against the drive's criteria, with the campus CGPA rule applied. A member with no confirmed profile is `unknown`. Each member's own verdict is stored in `drive_checks`, and only that member can read it.
- **Counts:** `drive_eligible`, `drive_unknown` and `drive_ineligible`, over verified members whose placed flag has not just changed. Unknown is never a block.
- **Differencing guard (`K_DRIVE` = 10):** a drive's counts are released only if, for every earlier released drive of the cohort, its verdicts differ for zero members or for at least 10 members. Closed drives whose counts were released are included in that comparison. Otherwise that drive's counts are not written for the day, and the TPO sees them as suppressed. This stops two near-identical drives being subtracted to isolate one student.
- **Scope of the verdict:** the drive inbox (`GET /api/v1/campus/drives`) reads each student's own profile. The TPO never sees a student's verdict. The CGPA rule used is the campus rule only (see `docs/eligibility.md` §5).

## 6. Staff lifecycle

- **Invite.** Only an owner can invite, by email. The address is stored as a keyed hash. An invite lasts 14 days. An expired, unclaimed invite is re-issued when the owner invites the same address again. The response is `invited` or `exists`.
- **Claim.** A pending invite is claimed the next time the invitee calls any TPO route with a **verified** account email that matches the invite. There is no separate accept step. One seat per user per campus.
- **Roles.** `owner` and `staff`.
  - Owner: invite, list (without email addresses), remove a seat or an open invite, transfer ownership.
  - Staff: read stats, outcomes, drives and the NAAC export, publish drives, and import the roster (see the open item in §4).
- **Remove.** An owner removes a seat or an open invite. The last owner cannot be removed (`409 last_owner`). Logged as `staff_removed`.
- **Transfer.** An owner hands ownership to a claimed staff member. The caller becomes staff. Logged as `ownership_transferred`. The target must be claimed.
- **Campus choice.** A call names a campus, or the caller's only campus is used. If the caller staffs several campuses and names none, the call is `400 campus_required`. Naming a campus the caller does not staff is `404`.
- **Every staff call claims invites.** Because claiming runs on every TPO call, some GET requests write a row (see §8).

## 7. Outcomes and NAAC

- **Report.** A student reports an interview or an offer: employer, role title, package (LPA, up to 1000) and kind. A student can have at most 50 outcomes. The outcome starts as `student_reported`.
- **Letter.** An offer letter is a PDF of at most 2 MiB, sealed and bound to its owner and row. A TPO can download it only if the student has consented to share it with the TPO (`offer_letter_tpo`). Each view writes `letter_view`.
- **Verify.** A TPO marks an outcome `tpo_verified` (logged as `outcome_verify`).
- **NAAC export.** CSV in the shape of criterion 5.2.1 (year of placement, student, programme, employer, package, and a Verification column of our own). **The headers are not checked against the NAAC manual for the current cycle** (the file says so). Check before a college files with it.

## 8. Reads that write rows

GET requests are not side-effect free in this slice. This is deliberate for the audit log, but it is an open item (see `docs/apply.md`).

| Route | What it writes |
|---|---|
| Every `/api/v1/tpo/*` GET | Runs `tpo_claim_invites`. It updates a pending invite if one matches the caller's verified email. |
| `GET /api/v1/tpo/outcomes` | One `outcomes_list` row for each student listed. |
| `GET /api/v1/tpo/outcomes/{id}/letter` | A `letter_view` row. |
| `GET /api/v1/tpo/export/naac` | A `naac_export` row for each student included. |

Writes that are not GET: outcome verification, staff changes and the join and share routes.

## 9. Limits and open items

- The campus rule is the only CGPA rule a drive or a student's answer can use. The university rule table is not wired in (`docs/eligibility.md` §5, `docs/apply.md` "Open before pilot").
- **Noise or rounding.** The numbers use k = 10, complementary suppression and rounding to 5. Adding noise is an open decision.
- **Join-screen wording.** The copy on the join screen has not been decided.
- **Roster-import role.** Any staff seat can import today. Owner-only is the alternative.
- **The student eligibility screen** (`/you/eligibility`) is not built. The folder holds `actions.ts` only.
- **Tests:** `packages/db/test/campus.test.ts`, `packages/services/test/campus-codes.test.ts`, `packages/services/test/campus-csv.test.ts`, `apps/web/tests/campus-api.test.ts`, `workers/runner/test/campus-stats.test.ts`.

## Related

- `docs/public-api.md` §14: the campus, TPO and apply routes.
- `docs/eligibility.md`: the criteria and the CGPA rule behind the drive verdicts.
- `docs/apply.md`: the application side and the open items list.
- `docs/design/campus-build-plan.md`: the slices and their acceptance boxes.
