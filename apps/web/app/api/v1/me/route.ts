import { getMe, parseInput } from "@hirelane/services";
import { v1 } from "@/lib/http";
import { DeleteMeInput } from "@/lib/http/me-inputs";
import { defaultAuthDeps, deleteAccountFor } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await getMe(ctx) }));

/**
 * Erasure (DPDP): revokes every session, deletes the stored files, then the account. No Idempotency-Key: the key's
 * owner is the row being deleted, and a repeat is already harmless (the session is gone, so it is a 401).
 */
export const DELETE = v1({ mutation: true, idempotent: false, body: "json", rate: { name: "delete-account", max: 3, windowSeconds: 600 } }, async ({ ctx, input }) => {
  parseInput(DeleteMeInput, input);
  await deleteAccountFor(defaultAuthDeps(), ctx.userId);
  return { status: 200, body: { deleted: true } };
});
