import type { ServiceCtx } from '../ctx';
import { withUserTx, type UserClient } from '../db';
import { mapPgError } from '../errors';
import { parseInput } from '../schema';
import { ensureAddressIn, readAddressIn } from './address';
import { AUTO_APPLY_DOC_VERSION, AutoApplyInput } from './inputs';

export interface ApplySettings {
  autoApply: boolean;
  decidedAt: string | null;
  applyAddress: string | null;
}

/** The newest auto_apply row wins. No row means no consent: Hirelane never submits until the student has said yes. */
export async function autoApplyIn(c: UserClient, userId: string): Promise<{ granted: boolean; at: Date | null }> {
  const r = (await c.query("SELECT granted, at FROM consents WHERE user_id = $1 AND kind = 'auto_apply' ORDER BY at DESC, id DESC LIMIT 1", [userId])).rows[0];
  return r ? { granted: r.granted === true, at: r.at as Date } : { granted: false, at: null };
}

export async function getApplySettings(ctx: ServiceCtx): Promise<ApplySettings> {
  try {
    return await withUserTx(ctx, async (c) => {
      const consent = await autoApplyIn(c, ctx.userId);
      const addr = await readAddressIn(c, ctx.userId);
      return { autoApply: consent.granted, decidedAt: consent.at ? consent.at.toISOString() : null, applyAddress: addr?.address ?? null };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

/**
 * Switch auto-apply on or off. Append-only like every consent: a withdrawal is a new row with granted=false.
 * Turning it on also creates the student's apply address, so the screen can show which address will be used.
 */
export async function setAutoApply(ctx: ServiceCtx, input: unknown): Promise<ApplySettings> {
  const { granted } = parseInput(AutoApplyInput, input);
  try {
    return await withUserTx(ctx, async (c) => {
      // The app role cannot choose the timestamp (migration 0009): the database stamps it.
      const row = (
        await c.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'auto_apply', $2, $3) RETURNING at", [ctx.userId, granted, AUTO_APPLY_DOC_VERSION])
      ).rows[0];
      const addr = granted ? await ensureAddressIn(c, ctx.userId) : await readAddressIn(c, ctx.userId);
      return { autoApply: granted, decidedAt: (row.at as Date).toISOString(), applyAddress: addr?.address ?? null };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}
