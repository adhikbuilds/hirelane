import type { Mailer } from '@hirelane/agent';
import { evaluateEligibility, type Criterion } from '@hirelane/engine';
import type { KeyProvider } from '@hirelane/vault';
import { asCgpaRule, profileFromRow, universityFor } from '../campus/drives';
import { istDay, nextDay } from '../campus/ist';
import { isCritical, NOTIFY_KINDS, type NotifyKind } from './kinds';
import { renderNotificationEmail } from './templates';
import { tokenHash, unsubscribeToken, unsubscribeUrl } from './token';

/** The one query method the sweep needs. In production it is the worker's owner connection, never a student's session. */
export interface NotifyDb {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface NotifyDeps {
  db: NotifyDb;
  /** Mail goes through the existing Mailer: the file outbox in development, the real transport once the owner picks one. */
  mailer: Mailer;
  keys: KeyProvider;
  now: () => Date;
  /** Origin of the web app, for the Home and unsubscribe links. */
  appUrl: string;
}

const DAY_MS = 86_400_000;
/** A drive is announced to students that long after it goes live and no later; the drive inbox still shows it. */
const ANNOUNCE_WINDOW_DAYS = 7;


const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1) + '…');

interface DriveRow {
  id: string;
  title: string;
  cohort_id: string;
  criteria: unknown;
  cgpa_rule: unknown;
  campus_name: string;
}

/**
 * Who should hear about a drive: every member of its cohort who is not placed, minus the ones whose own confirmed profile fails
 * a stated rule. Unknown is never a block. Returns the user ids and whether each one still has a rule to check.
 */
async function audience(db: NotifyDb, d: DriveRow): Promise<{ userId: string; check: boolean }[]> {
  const members = (await db.query('SELECT user_id FROM cohort_members WHERE cohort_id = $1 AND NOT placed ORDER BY user_id', [d.cohort_id])).rows.map((r) => r.user_id as string);
  if (members.length === 0) return [];
  const profiles = new Map((await db.query('SELECT * FROM eligibility_profiles WHERE user_id = ANY($1::uuid[])', [members])).rows.map((r) => [r.user_id as string, r]));
  const criteria = (Array.isArray(d.criteria) ? d.criteria : []) as Criterion[];
  const cgpaRule = asCgpaRule(d.cgpa_rule);
  const universityRule = universityFor(d.campus_name);
  const out: { userId: string; check: boolean }[] = [];
  for (const userId of members) {
    const res = evaluateEligibility(criteria, profileFromRow(profiles.get(userId)), { cgpaRule, universityRule });
    if (res.overall === 'fail') continue;
    out.push({ userId, check: res.overall === 'unknown' && res.verdicts.length > 0 });
  }
  return out;
}

async function insertForDrive(deps: NotifyDeps, d: DriveRow, kind: 'drive_published' | 'drive_closing', title: (check: boolean) => string): Promise<number> {
  const who = await audience(deps.db, d);
  if (who.length === 0) return 0;
  const titles = who.map((w) => clip(title(w.check), 200));
  const r = await deps.db.query(
    `INSERT INTO notifications (user_id, kind, title, drive_id, dedupe_key, email_state)
     SELECT u, $2, t, $3, $4, 'pending' FROM unnest($1::uuid[], $5::text[]) AS x(u, t)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [who.map((w) => w.userId), kind, d.id, `${kind}:${d.id}`, titles],
  );
  return r.rowCount ?? 0;
}

/**
 * New-drive notifications: a Home row for each student of an announced drive's cohort who is eligible or still to be checked.
 * A draft is not announced, so it notifies nobody. Safe to run repeatedly: one row per student per drive.
 */
export async function notifyNewDrives(deps: NotifyDeps): Promise<{ drives: number; created: number }> {
  const since = new Date(deps.now().getTime() - ANNOUNCE_WINDOW_DAYS * DAY_MS);
  const drives = (
    await deps.db.query(
      `SELECT d.id, d.title, d.cohort_id, d.criteria, ca.cgpa_rule, ca.name AS campus_name FROM drives d JOIN campuses ca ON ca.id = d.campus_id
        WHERE d.status = 'published' AND d.announced_at IS NOT NULL AND d.announced_at > $1
          AND (d.deadline IS NULL OR d.deadline >= $2::date)
        ORDER BY d.announced_at, d.id`,
      [since, istDay(deps.now())],
    )
  ).rows as DriveRow[];
  let created = 0;
  for (const d of drives) created += await insertForDrive(deps, d, 'drive_published', (check) => (check ? `New drive: ${d.title} (some rules need your check)` : `New drive for you: ${d.title}`));
  return { drives: drives.length, created };
}

/** "Closes tomorrow": live drives whose deadline is tomorrow in India, to the same audience. One row per student per drive. */
export async function notifyClosingTomorrow(deps: NotifyDeps): Promise<{ drives: number; created: number }> {
  const tomorrow = nextDay(istDay(deps.now()));
  const drives = (
    await deps.db.query(
      `SELECT d.id, d.title, d.cohort_id, d.criteria, ca.cgpa_rule, ca.name AS campus_name FROM drives d JOIN campuses ca ON ca.id = d.campus_id
        WHERE d.status = 'published' AND d.announced_at IS NOT NULL AND d.deadline = $1::date ORDER BY d.id`,
      [tomorrow],
    )
  ).rows as DriveRow[];
  let created = 0;
  for (const d of drives) created += await insertForDrive(deps, d, 'drive_closing', () => `Closes tomorrow: ${d.title}`);
  return { drives: drives.length, created };
}

export const REPLY_LABEL = { interview: 'invited you to an interview', test: 'sent you a test', rejection: 'sent an update on your application', other: 'replied to your application' } as const;
export interface EmployerReplyEvent {
  userId: string;
  employer: string;
  kind: keyof typeof REPLY_LABEL;
  applicationId: string | null;
  inboundId: string;
}

/** Employer-reply notification for one forwarded message: a Home row and, by the sweep, an email. One per message. */
export async function notifyEmployerReply(deps: NotifyDeps, e: EmployerReplyEvent): Promise<{ created: boolean }> {
  const r = await deps.db.query(
    `INSERT INTO notifications (user_id, kind, title, application_id, inbound_id, dedupe_key, email_state)
     VALUES ($1, 'employer_reply', $2, $3, $4, $5, 'pending')
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [e.userId, clip(`${e.employer.trim() || 'An employer'} ${REPLY_LABEL[e.kind]}`, 200), e.applicationId, e.inboundId, `employer_reply:${e.inboundId}`],
  );
  return { created: (r.rowCount ?? 0) > 0 };
}

export interface EmailSweep {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Mails every pending notification of the four kinds, through the Mailer. At most once per notification: a row is claimed
 * before it is sent, and a crash after the claim leaves it unsent (never twice). Per student: an unverified address gets
 * nothing; an optional kind follows the student's email setting; critical kinds always go. One failed send does not stop the
 * rest, and no address or message text is ever logged.
 */
export async function sendPendingEmails(deps: NotifyDeps, opts: { limit?: number } = {}): Promise<EmailSweep> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const rows = (
    await deps.db.query(
      `SELECT n.id, n.user_id, n.kind, n.title, u.email, u.email_verified_at IS NOT NULL AS verified, p.email AS pref_email
         FROM notifications n JOIN users u ON u.id = n.user_id LEFT JOIN notification_prefs p ON p.user_id = n.user_id AND p.kind = n.kind
        WHERE n.email_state = 'pending' AND n.emailed_at IS NULL AND n.kind = ANY($1::text[])
        ORDER BY n.created_at, n.id LIMIT $2`,
      [[...NOTIFY_KINDS], limit],
    )
  ).rows;
  const out: EmailSweep = { sent: 0, skipped: 0, failed: 0 };
  for (const r of rows) {
    const kind = r.kind as NotifyKind;
    if (!r.verified || (!isCritical(kind) && r.pref_email === false)) {
      await deps.db.query("UPDATE notifications SET email_state = 'skipped' WHERE id = $1 AND email_state = 'pending'", [r.id]);
      out.skipped++;
      continue;
    }
    const claim = await deps.db.query("UPDATE notifications SET emailed_at = $2 WHERE id = $1 AND email_state = 'pending' AND emailed_at IS NULL RETURNING id", [r.id, deps.now()]);
    if ((claim.rowCount ?? 0) === 0) continue;
    try {
      let link: string | null = null;
      if (!isCritical(kind)) {
        const token = await unsubscribeToken(deps.keys, r.user_id);
        await deps.db.query('INSERT INTO notification_unsub (user_id, token_hash) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING', [r.user_id, tokenHash(token)]);
        link = unsubscribeUrl(deps.appUrl, token);
      }
      const { subject, text } = renderNotificationEmail({ kind, title: r.title, appUrl: deps.appUrl, unsubscribeUrl: link });
      await deps.mailer.send({ to: r.email, subject, text });
      await deps.db.query("UPDATE notifications SET email_state = 'sent' WHERE id = $1", [r.id]);
      out.sent++;
    } catch {
      await deps.db.query("UPDATE notifications SET email_state = 'failed' WHERE id = $1", [r.id]).catch(() => undefined);
      out.failed++;
    }
  }
  return out;
}

export interface SweepResult {
  newDrives: { drives: number; created: number };
  closing: { drives: number; created: number };
  email: EmailSweep;
}

/** One pass for a scheduler: new-drive rows, closes-tomorrow rows, then the mail. Idempotent. */
export async function runNotifySweep(deps: NotifyDeps): Promise<SweepResult> {
  const newDrives = await notifyNewDrives(deps);
  const closing = await notifyClosingTomorrow(deps);
  const email = await sendPendingEmails(deps);
  return { newDrives, closing, email };
}
