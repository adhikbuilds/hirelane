import { revealOutcomes } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The outcome list with student names (and emails at share level full). An explicit action, not a read: each student named is
 * written to their access log in the same transaction. No Idempotency-Key: a replayed response would be a copy of names
 * that skipped the log.
 */
export const POST = v1({ mutation: true, idempotent: false, body: "json" }, async ({ ctx, input }) => {
  const body = (input && typeof input === "object" ? input : {}) as { campusId?: string; cohortId?: string };
  return { status: 200, body: await revealOutcomes(ctx, { ...(body.campusId ? { campusId: body.campusId } : {}), ...(body.cohortId ? { cohortId: body.cohortId } : {}) }) };
});
