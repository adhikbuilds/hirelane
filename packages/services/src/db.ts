import { withUser } from '@hirelane/db';
import type { ServiceCtx } from './ctx';

/**
 * The only door to the database for a service. Always the unprivileged `hirelane_app` role with the ctx user
 * bound, so RLS applies. There is deliberately no owner-role variant: services are never on the admin-connection allowlist.
 */
/** pg's UserClient, taken from withUser's signature so services need no direct pg dependency. */
export type UserClient = Parameters<Parameters<typeof withUser>[1]>[0];

export function withUserTx<T>(ctx: ServiceCtx, fn: (client: UserClient) => Promise<T>): Promise<T> {
  return withUser(ctx.userId, fn);
}
