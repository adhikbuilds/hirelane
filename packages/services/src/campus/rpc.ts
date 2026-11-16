import type { ServiceCtx } from '../ctx';
import { withUserTx, type UserClient } from '../db';
import { mapPgError } from '../errors';

/**
 * Calls a SECURITY DEFINER function from migration 0011a. The name is a literal in this package (never user input), and
 * every argument is a bind parameter. The acting user is not an argument: the function reads it from the transaction.
 */
export async function callIn<T>(c: UserClient, fn: string, args: readonly unknown[] = []): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const r = await c.query(`SELECT ${fn}(${placeholders}) AS r`, args as unknown[]);
  return r.rows[0]!.r as T;
}

export async function rpc<T>(ctx: ServiceCtx, fn: string, args: readonly unknown[] = []): Promise<T> {
  try {
    return await withUserTx(ctx, (c) => callIn<T>(c, fn, args));
  } catch (e) {
    throw mapPgError(e);
  }
}
