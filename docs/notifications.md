# Notifications (Home rows and email)

**Status:** built, uncommitted, 2026-11-01. The database side, the services, the sweep and the unsubscribe page are in the working tree. **No notification list route and no Home screen read exist yet** (§6). Email goes through the file outbox only: there is no production mail transport (`docs/apply.md` open list, item 7).

**Owner decision:** every notification is also a row on Home, so a missed email loses nothing (`docs/product/COMPETITOR-GAP-2026-10-31.md`, P0-6). Web push and WhatsApp are not built (owner decision 5 in that file). Quiet hours are not built.

**Sources:**

- Schema: `packages/db/migrations/0015_picks_notify_drives.sql` (the kinds, the new columns, `notification_prefs`, `notification_unsub`, `notify_unsubscribe`, `tpo_verify_outcome`).
- Services: `packages/services/src/notify/` (`kinds.ts` the kinds and the critical and optional split, `dispatch.ts` the row writers and the sweep, `templates.ts` the mail text, `token.ts` the unsubscribe token, `student.ts` the list, prefs and unsubscribe reads and writes, `index.ts`).
- Worker: `workers/runner/src/tasks/notify-sweep.ts` (`notify:sweep`).
- Web: `apps/web/app/unsubscribe/page.tsx` (GET) and `apps/web/app/unsubscribe/actions.ts` (POST, `confirmUnsubscribe`).
- Crontab: `*/10 * * * * notify:sweep` (`workers/runner/crontab`).
- Tests: `packages/services/test/notify.test.ts` (pure parts), `apps/web/tests/notify.test.ts` (database), `apps/web/tests/unsubscribe.test.ts`, `workers/runner/test/notify-sweep.test.ts`, `packages/db/test/drives-notify.test.ts`.

---

## 1. The kinds

| Kind | Written by | Email | Off-switch for the student |
|---|---|---|---|
| `drive_published` | `notifyNewDrives`, from the sweep | yes, optional | yes (`notification_prefs`) |
| `drive_closing` | `notifyClosingTomorrow`, from the sweep | yes, optional | yes |
| `employer_reply` | `notifyEmployerReply` (not called yet, §6) | yes, critical | no |
| `outcome_verified` | `tpo_verify_outcome`, in the database, for an offer | yes, critical | no |

- **Critical** kinds (`employer_reply`, `outcome_verified`) are always emailed. They are about the student's own applications and offers. Their mail says so, and has no unsubscribe link.
- **Optional** kinds (`drive_published`, `drive_closing`) can be turned off for email. The Home row stays.
- The table's CHECK also allows `employer_message` (what `inbound:scan` writes for a forwarded employer message) and `application_update`. Neither is in the sweep, so neither gets an email from it. The forward is the email for an employer message (`docs/apply.md` §8).

## 2. The Home rows

- One row per event per student: `notifications.dedupe_key` with a unique index per user. A repeated sweep, or a repeated call, cannot write a second row.
- Keys: `drive_published:<driveId>`, `drive_closing:<driveId>`, `employer_reply:<inboundId>`, `outcome_verified:<outcomeId>`.
- Drive rows link to the drive (`drive_id`), outcome rows to the outcome (`outcome_id`), employer rows to the application and the inbound message.

### Who hears about a drive

- **`drive_published`** (`notifyNewDrives`). The drive must be published, announced (not a draft) within the last **7 days**, and its deadline must be missing or not yet past (IST day). The audience is every **non-placed** member of the drive's cohort, minus any member whose own confirmed profile **fails** a stated rule. Unknown is never a block. A member with a rule still to check gets "New drive: <title> (some rules need your check)". Everyone else gets "New drive for you: <title>". Drafts notify nobody.
- **`drive_closing`** (`notifyClosingTomorrow`). A published, announced drive whose deadline is **tomorrow in India** gets "Closes tomorrow: <title>", to the same audience. The day is worked out in IST, so a run at 23:30 UTC on 31 October is already 1 November in India.

The audience rule is `audience()` in `dispatch.ts`. It reads each member's profile through the owner connection, so a student's own data is read by the worker, not by the student's session.

### Outcome verified

`tpo_verify_outcome` (migration 0015) writes the row in the same transaction as the verification, but only for an **offer**. An interview verification writes no row. The title is "Your offer from <employer> was verified by your placement cell".

### Employer reply (not wired)

`notifyEmployerReply` writes an `employer_reply` row with the title "<employer> invited you to an interview", "sent you a test", "sent an update on your application" or "replied to your application", by the classified kind. It has tests. **Nothing calls it.** `inbound:scan` writes an `employer_message` row instead (`docs/apply.md` §8, open list item 9).

## 3. Email: the sweep

`sendPendingEmails` sends every `pending` row of the four kinds, oldest first, at most **200** a pass (1 to 1000 allowed). For each row:

1. **Skip** when the student's address is not verified, or when the kind is optional and the student has turned its email off. The row becomes `skipped`.
2. **Claim.** The row's `emailed_at` is set before anything is sent. A crash after the claim leaves the row unsent, never sent twice.
3. **Unsubscribe link** (optional kinds only). The keyed token is stored as its SHA-256 in `notification_unsub` (one row per student, `ON CONFLICT DO NOTHING`), and the link goes in the mail.
4. **Send** through the `Mailer` (§5). The row becomes `sent`. A failed send becomes `failed` and does not stop the others. It is not retried, so it cannot be sent twice.

Nothing logs an address, a subject or a message body. Logs carry counts.

### The mail

Plain text only. The subject is the notification's title with control characters removed (so a title cannot start a new header), cut to 200 characters. The body is the title, one lead sentence for the kind, the Home link (`<app origin>/home`), and the optional-kind line "This is also on your Home screen". Optional kinds carry "Stop these emails: <link>". Critical kinds carry the line that they cannot be switched off. Scam flags are never shown, because they are for staff.

## 4. Unsubscribe and preferences

### The link

- The token is a keyed hash of the student's id (purpose `notify/unsub`, the vault's HMAC). Every mail to the same student carries the same token. Nobody can make one for another student without the key.
- The link is `<app origin>/unsubscribe?t=<token>`. The origin must be http or https.

### The page

- **GET `/unsubscribe?t=…`** only shows a confirm button. It changes nothing, so a link scanner that opens the mail's link cannot switch anything off. A malformed token shows "This link is not valid". The token is not echoed back.
- **POST** (the server action `confirmUnsubscribe`) calls `unsubscribeByToken`. That runs `notify_unsubscribe(sha256(token))`, which turns off **both** optional kinds. The answer is the same for a good token and a bad one, so the page cannot be used to test whether a token exists. Then it redirects to `/unsubscribe?done=1`.
- Only the two optional kinds change. Home rows and critical mail are unaffected.

### Preferences

- `getNotificationPrefs` returns all four kinds. A kind with no stored choice is on. The two critical kinds are `locked: true`.
- `setNotificationPref` accepts only the two optional kinds (`SetPrefInput`). Any other kind is a 400.
- Both functions are in the services. **No v1 route calls them yet** (§6).

## 5. Schedule, transport and config

- **`notify:sweep`** runs every **10 minutes** (`*/10 * * * *`). One pass does: new-drive rows, closes-tomorrow rows, then the email. Each step is idempotent.
- It uses the worker's owner connection (`adminRun`), never a student's session.
- **Mailer.** `createMailer()` (`packages/agent/src/mail/factory.ts`). Outside production it is the file outbox (`HIRELANE_MAIL_OUTBOX`, default `<repo>/.mail/outbox`). In production it throws unless a real transport is injected. So in production the sweep fails until a transport is wired (`docs/apply.md` open list, item 7).
- **App origin** for the links: `HIRELANE_APP_ORIGIN`, default `http://localhost:3001`.
- The sweep logs one line of counts: new drives, closing, and email sent, skipped and failed.

## 6. What is wired and what is not

| Piece | State |
|---|---|
| Drive rows (new drive, closes tomorrow) | Built, tested, scheduled. Runs every 10 minutes. |
| Offer-verified row | Built (database). Tested. |
| Email sweep, claim-before-send, skip rules | Built, tested. Needs a production transport. |
| Unsubscribe page and token | Built, tested. |
| `employer_reply` row | Built and tested. **Not called from `inbound:scan`.** Replies today give `employer_message` rows (no email from the sweep; the forward is the email). |
| Notification list (`listNotifications`, unread count, newest 50) | Built in the services. **No v1 route and no Home screen read.** The Home screen reads picks, applications, the inbox, drives and resumes (`apps/web/lib/student/load.ts`), not notifications. |
| Preferences (`getNotificationPrefs`, `setNotificationPref`) | Built in the services. **No v1 route and no screen.** The only email switch today is the unsubscribe link. |
| Quiet hours | **Not built.** |
| Web push, WhatsApp | **Not built** (owner decision). |
| Delivery and open counts in ops (P0-6) | **Not built.** |

Until the first two gaps close, a student gets email for a drive or an offer but cannot see the Home rows in the app, and cannot change the drive emails except with the unsubscribe link.

## 7. Related

- `docs/apply.md` §8 (employer mail), and its open list.
- `docs/campus.md` §5 (drives) and §7 (outcomes).
- `docs/public-api.md` §14 (the v1 routes, including the ones that do not exist yet).
- `docs/product/COMPETITOR-GAP-2026-10-31.md` P0-6, the source of the list above.
