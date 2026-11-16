import type { ServiceCtx } from '../ctx';
import { withUserTx } from '../db';
import { mapPgError } from '../errors';
import { inboundViews, type InboundView } from './tracker';

/** Every employer message forwarded to this student, newest first, with the number of unread notifications. */
export async function listInbox(ctx: ServiceCtx): Promise<{ unread: number; messages: InboundView[] }> {
  try {
    return await withUserTx(ctx, async (c) => {
      const unread = (await c.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [ctx.userId])).rows[0]?.n ?? 0;
      return { unread: Number(unread), messages: await inboundViews(ctx, c, '', []) };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

export async function markInboxRead(ctx: ServiceCtx): Promise<{ marked: number }> {
  try {
    return await withUserTx(ctx, async (c) => {
      const r = await c.query('UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL', [ctx.userId, ctx.now()]);
      return { marked: r.rowCount ?? 0 };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}
