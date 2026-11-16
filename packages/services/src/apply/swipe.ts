import { randomUUID } from 'node:crypto';
import { applyMode } from '@hirelane/agent';
import type { ServiceCtx } from '../ctx';
import { withUserTx } from '../db';
import { mapPgError, notFound, ServiceError } from '../errors';
import { parseInput } from '../schema';
import { ensureAddressIn } from './address';
import { autoApplyIn } from './consent';
import { ApplicationIdInput, SwipeInput } from './inputs';

export interface SwipeResult {
  application: { id: string; status: string; undoUntil: string; created: boolean };
  applyAddress: string;
  autoApply: boolean;
}

/** jobKey for the submit task: one pending run per application. */
export const submitJobKey = (applicationId: string): string => `apply:submit:${applicationId}`;

const constraintOf = (e: unknown): string | undefined => (typeof e === 'object' && e !== null ? ((e as { constraint?: string }).constraint ?? undefined) : undefined);

/**
 * Right swipe = applied. Creates the application (ready, with the 4 second undo window) and queues the submit task.
 * The task, not this function, decides whether anything is actually sent: consent, daily cap and kill switch are checked there.
 * Swiping again on a job that is already in progress changes nothing; swiping again after an undo reopens the window.
 */
export async function swipeRight(ctx: ServiceCtx, input: unknown): Promise<SwipeResult> {
  const { jobId, resumeId } = parseInput(SwipeInput, input);
  // Global switch (HIRELANE_AUTO_APPLY): off in production unless an operator turns it on. Nothing is created or queued.
  if (applyMode() === 'off') throw new ServiceError('auto_apply_off', 503);
  let out: SwipeResult & { enqueue: boolean };
  try {
    out = await withUserTx(ctx, async (c) => {
      const addr = await ensureAddressIn(c, ctx.userId);
      const consent = await autoApplyIn(c, ctx.userId);
      let resume: string | null = null;
      if (resumeId) {
        const r = (await c.query('SELECT id FROM resumes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND purged_at IS NULL', [resumeId, ctx.userId])).rows[0];
        if (!r) throw notFound();
        resume = r.id as string;
      } else {
        const r = (await c.query('SELECT id FROM resumes WHERE user_id = $1 AND is_default AND deleted_at IS NULL AND purged_at IS NULL', [ctx.userId])).rows[0];
        resume = r ? (r.id as string) : null;
      }
      const existing = (await c.query('SELECT id, status, undo_until FROM applications WHERE user_id = $1 AND job_id = $2', [ctx.userId, jobId])).rows[0];
      const shape = (id: string, status: string, undo: Date, created: boolean, enqueue: boolean) => ({
        application: { id, status, undoUntil: undo.toISOString(), created },
        applyAddress: addr.address,
        autoApply: consent.granted,
        enqueue,
      });
      if (existing && existing.status !== 'undone') return shape(existing.id, existing.status, existing.undo_until, false, false);
      if (existing) {
        const r = (await c.query("UPDATE applications SET status = 'ready' WHERE id = $1 AND status = 'undone' RETURNING id, status, undo_until", [existing.id])).rows[0];
        if (!r) throw new ServiceError('conflict', 409);
        return shape(r.id, r.status, r.undo_until, true, true);
      }
      const r = (
        await c.query('INSERT INTO applications (id, user_id, job_id, resume_id) VALUES ($1, $2, $3, $4) RETURNING id, status, undo_until', [randomUUID(), ctx.userId, jobId, resume])
      ).rows[0];
      return shape(r.id, r.status, r.undo_until, true, true);
    });
  } catch (e) {
    switch (constraintOf(e)) {
      case 'applications_job_open':
        throw new ServiceError('job_closed', 409);
      case 'applications_apply_target':
        throw new ServiceError('job_not_applicable', 409);
      case 'applications_user_job_uq':
        throw new ServiceError('conflict', 409);
    }
    if ((e as { code?: string }).code === '23503') throw notFound();
    throw mapPgError(e);
  }
  if (out.enqueue) {
    // The row is committed. If the queue is down the student must not see a failure: apply:sweep (every 5 minutes) re-queues
    // any ready application whose window has closed, and the claim is idempotent.
    await ctx.enqueue('apply:submit', { applicationId: out.application.id }, { jobKey: submitJobKey(out.application.id) }).catch(() => undefined);
  }
  const { enqueue: _enqueue, ...result } = out;
  return result;
}

/**
 * Take a right swipe back. Allowed only while the application is still ready and its window is open; the database
 * decides, in one statement, so an undo racing the worker's claim has exactly one winner.
 */
export async function undoApplication(ctx: ServiceCtx, input: unknown): Promise<{ id: string; status: 'undone' }> {
  const { id } = parseInput(ApplicationIdInput, input);
  try {
    return await withUserTx(ctx, async (c) => {
      const won = await c.query("UPDATE applications SET status = 'undone' WHERE id = $1 AND user_id = $2 AND status = 'ready' AND undo_until > now() RETURNING id", [id, ctx.userId]);
      if (won.rowCount === 1) return { id, status: 'undone' as const };
      const have = (await c.query('SELECT status FROM applications WHERE id = $1 AND user_id = $2', [id, ctx.userId])).rows[0];
      if (!have) throw notFound();
      throw new ServiceError('undo_window_closed', 409);
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

/**
 * "Needs you" is not a dead end. After the student has answered the question that blocked an application (answer bank), this puts
 * it back to `ready` with a fresh 4 second window and queues the submit task again. Only an application blocked for `needs_you`
 * can be re-armed (the database trigger enforces it); a captcha or login wall stays "finish on their site".
 */
export async function rearmApplication(ctx: ServiceCtx, input: unknown): Promise<{ id: string; status: 'ready'; undoUntil: string }> {
  const { id } = parseInput(ApplicationIdInput, input);
  let out: { id: string; status: 'ready'; undoUntil: string };
  try {
    out = await withUserTx(ctx, async (c) => {
      const have = (await c.query('SELECT status, blocked_reason FROM applications WHERE id = $1 AND user_id = $2', [id, ctx.userId])).rows[0];
      if (!have) throw notFound();
      if (have.status !== 'blocked_fallback' || have.blocked_reason !== 'needs_you') throw new ServiceError('not_rearmable', 409);
      const r = (await c.query("UPDATE applications SET status = 'ready' WHERE id = $1 AND user_id = $2 AND status = 'blocked_fallback' RETURNING undo_until", [id, ctx.userId])).rows[0];
      if (!r) throw new ServiceError('conflict', 409);
      return { id, status: 'ready' as const, undoUntil: (r.undo_until as Date).toISOString() };
    });
  } catch (e) {
    throw mapPgError(e);
  }
  await ctx.enqueue('apply:submit', { applicationId: id }, { jobKey: submitJobKey(id) }).catch(() => undefined);
  return out;
}

/**
 * "I finished on their site." Moves a blocked application to submitted by the student (manual_finish), so the tracker can go on
 * and inbound replies keep matching it. The receipt of the blocked attempt stays as it was: sent:false. Nothing was sent by us.
 */
export async function markFinishedByStudent(ctx: ServiceCtx, input: unknown): Promise<{ id: string; status: 'submitted' }> {
  const { id } = parseInput(ApplicationIdInput, input);
  try {
    return await withUserTx(ctx, async (c) => {
      const won = await c.query("UPDATE applications SET status = 'submitted' WHERE id = $1 AND user_id = $2 AND status = 'blocked_fallback' RETURNING id", [id, ctx.userId]);
      if (won.rowCount === 1) return { id, status: 'submitted' as const };
      const have = (await c.query('SELECT 1 FROM applications WHERE id = $1 AND user_id = $2', [id, ctx.userId])).rows[0];
      if (!have) throw notFound();
      throw new ServiceError('not_blocked', 409);
    });
  } catch (e) {
    throw mapPgError(e);
  }
}
