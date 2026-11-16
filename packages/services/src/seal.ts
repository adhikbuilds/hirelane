import { open, seal } from '@hirelane/vault';
import type { ServiceCtx } from './ctx';
import { ServiceError } from './errors';

/** Seal a JSON value under an AAD. The result goes straight into a bytea column. */
export const sealJson = (ctx: ServiceCtx, aad: string, value: unknown): Promise<Buffer> =>
  seal(ctx.keys, Buffer.from(JSON.stringify(value), 'utf8'), { aad });

/** Open a sealed JSON value. A bad envelope is a 500 with no detail: the content is never echoed. */
export async function openJson(ctx: ServiceCtx, aad: string, sealed: Buffer): Promise<unknown> {
  try {
    return JSON.parse((await open(ctx.keys, sealed, { aad })).toString('utf8'));
  } catch {
    throw new ServiceError('unreadable_record', 500);
  }
}
