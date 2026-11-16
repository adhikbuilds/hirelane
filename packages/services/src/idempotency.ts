import { createHash } from 'node:crypto';
import type { ServiceCtx } from './ctx';
import { withUserTx } from './db';
import { mapPgError, ServiceError } from './errors';
import { openJson, sealJson } from './seal';

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,200}$/;
/** A pending claim older than this is treated as a crashed request and may be retaken. */
const STALE_PENDING_MS = 2 * 60_000;

export interface Replayable {
  status: number;
  body: unknown;
}
interface Stored {
  fp: string;
  state: 'pending' | 'done';
  status?: number;
  /** The response body, sealed with the vault (AAD idem:<user>:<key>): replay bodies can carry decrypted PII. */
  sealed?: string;
}

const aadOf = (userId: string, key: string): string => `idem:${userId}:${key}`;

/** What the key is bound to: same key with another method, path or body is a client bug (422), not a replay. */
export const fingerprint = (method: string, path: string, body: string | Buffer = ''): string =>
  createHash('sha256').update(`${method.toUpperCase()}\n${path}\n`).update(body).digest('hex');

/**
 * Runs `fn` at most once per (user, key). First caller claims the key (pending), runs, stores the JSON response; a
 * repeat gets the stored response (replayed=true). The stored body is sealed with the vault, never plaintext jsonb. A concurrent repeat while pending is 409. A failed run releases the
 * key so the client can retry. Only JSON-able responses are stored: do not put file bytes or PII here beyond what the
 * API already returns to this same user.
 */
export async function runIdempotent(
  ctx: ServiceCtx,
  opts: { key: string; fp: string },
  fn: () => Promise<Replayable>,
): Promise<Replayable & { replayed: boolean }> {
  if (!IDEMPOTENCY_KEY_RE.test(opts.key)) throw new ServiceError('invalid_idempotency_key', 400);
  const pending: Stored = { fp: opts.fp, state: 'pending' };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const claimed = await withUserTx(ctx, async (c) => {
        const ins = await c.query(
          `INSERT INTO idempotency_keys (user_id, key, response, created_at) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (user_id, key) DO NOTHING`,
          [ctx.userId, opts.key, JSON.stringify(pending), ctx.now()],
        );
        if (ins.rowCount) return null;
        const row = (await c.query('SELECT response, created_at FROM idempotency_keys WHERE user_id = $1 AND key = $2', [ctx.userId, opts.key])).rows[0];
        return row as { response: Stored | null; created_at: Date } | undefined;
      });
      if (claimed === null) break;
      if (!claimed) continue; // deleted between the insert and the read: claim again
      const stored = claimed.response;
      if (stored && stored.fp !== opts.fp) throw new ServiceError('idempotency_key_reuse', 422);
      if (stored?.state === 'done') {
        const body = stored.sealed ? await openJson(ctx, aadOf(ctx.userId, opts.key), Buffer.from(stored.sealed, 'base64')) : undefined;
        return { status: stored.status ?? 200, body, replayed: true };
      }
      if (ctx.now().getTime() - claimed.created_at.getTime() < STALE_PENDING_MS) throw new ServiceError('idempotency_in_progress', 409);
      await withUserTx(ctx, (c) => c.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND response->>'state' = 'pending'", [ctx.userId, opts.key]));
      if (attempt === 1) throw new ServiceError('idempotency_in_progress', 409);
    }
  } catch (e) {
    throw mapPgError(e);
  }

  let result: Replayable;
  try {
    result = await fn();
  } catch (e) {
    await withUserTx(ctx, (c) => c.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [ctx.userId, opts.key])).catch(() => undefined);
    throw e;
  }
  const done: Stored = {
    fp: opts.fp,
    state: 'done',
    status: result.status,
    sealed: (await sealJson(ctx, aadOf(ctx.userId, opts.key), result.body ?? null)).toString('base64'),
  };
  await withUserTx(ctx, (c) => c.query('UPDATE idempotency_keys SET response = $3::jsonb WHERE user_id = $1 AND key = $2', [ctx.userId, opts.key, JSON.stringify(done)])).catch(() => undefined);
  return { ...result, replayed: false };
}
