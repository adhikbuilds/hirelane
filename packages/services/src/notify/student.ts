import { withUser } from '@hirelane/db';
import { z } from 'zod';
import type { ServiceCtx } from '../ctx';
import { withUserTx } from '../db';
import { mapPgError } from '../errors';
import { idSchema, parseInput } from '../schema';
import { NOTIFY_KINDS, OPTIONAL_KINDS, SetPrefInput, type NotifyKind } from './kinds';
import { tokenHash } from './token';

const ts = z.string().datetime({ offset: true });

export const NotificationSchema = z.strictObject({
  id: idSchema,
  kind: z.enum([...NOTIFY_KINDS, 'employer_message', 'application_update']),
  title: z.string(),
  driveId: idSchema.nullable(),
  outcomeId: idSchema.nullable(),
  applicationId: idSchema.nullable(),
  createdAt: ts,
  readAt: ts.nullable(),
});
export const NotificationListSchema = z.strictObject({ unread: z.number().int(), items: z.array(NotificationSchema) });
export type NotificationList = z.infer<typeof NotificationListSchema>;

/** The student's Home rows, newest first, with the unread count. Every kind arrives here, whatever their email setting. */
export async function listNotifications(ctx: ServiceCtx): Promise<NotificationList> {
  try {
    return await withUserTx(ctx, async (c) => {
      const unread = Number((await c.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [ctx.userId])).rows[0]?.n ?? 0);
      const rows = (
        await c.query('SELECT id, kind, title, drive_id, outcome_id, application_id, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT 50', [ctx.userId])
      ).rows;
      return {
        unread,
        items: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          driveId: r.drive_id ?? null,
          outcomeId: r.outcome_id ?? null,
          applicationId: r.application_id ?? null,
          createdAt: (r.created_at as Date).toISOString(),
          readAt: r.read_at ? (r.read_at as Date).toISOString() : null,
        })),
      };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

export const PrefsSchema = z.strictObject({
  prefs: z.array(z.strictObject({ kind: z.enum(NOTIFY_KINDS), email: z.boolean(), /** True for the kinds that are always emailed. */ locked: z.boolean() })),
});
export type Prefs = z.infer<typeof PrefsSchema>;

/** Email settings for all four kinds. A kind with no stored choice is on. */
export async function getNotificationPrefs(ctx: ServiceCtx): Promise<Prefs> {
  try {
    return await withUserTx(ctx, async (c) => {
      const stored = new Map((await c.query('SELECT kind, email FROM notification_prefs WHERE user_id = $1', [ctx.userId])).rows.map((r) => [r.kind as string, r.email === true]));
      return { prefs: NOTIFY_KINDS.map((kind) => ({ kind, email: (OPTIONAL_KINDS as readonly string[]).includes(kind) ? (stored.get(kind) ?? true) : true, locked: !(OPTIONAL_KINDS as readonly string[]).includes(kind) })) };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

/** Turn the email for one optional kind on or off. The two critical kinds have no setting (400). */
export async function setNotificationPref(ctx: ServiceCtx, input: unknown): Promise<Prefs> {
  const { kind, email } = parseInput(SetPrefInput, input);
  try {
    await withUserTx(ctx, async (c) => {
      await c.query(
        `INSERT INTO notification_prefs (user_id, kind, email) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, kind) DO UPDATE SET email = EXCLUDED.email, updated_at = now()`,
        [ctx.userId, kind satisfies NotifyKind, email],
      );
    });
  } catch (e) {
    throw mapPgError(e);
  }
  return getNotificationPrefs(ctx);
}

/** No user is signed in at this door; the database function sees no user and RLS returns nothing else. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

/**
 * The mail's one-click link. The token is the proof (it is checked in the database by its hash). The answer is the same for a
 * good and a bad token, so the door tells nobody whether a token exists. Turns email off for the two optional kinds; the
 * Home rows and the critical mail are unaffected.
 */
export async function unsubscribeByToken(token: unknown): Promise<{ unsubscribed: true }> {
  if (typeof token === 'string' && /^[0-9a-f]{64}$/.test(token)) {
    try {
      await withUser(NOBODY, async (c) => {
        await c.query('SELECT notify_unsubscribe($1)', [tokenHash(token)]);
      });
    } catch (e) {
      throw mapPgError(e);
    }
  }
  return { unsubscribed: true };
}
