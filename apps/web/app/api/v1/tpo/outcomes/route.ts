import { listOutcomes } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Outcomes of students who chose to share them (level outcomes or full), with the student's name and email withheld. Writes
 * nothing. To see who, call POST /api/v1/tpo/outcomes/reveal: that is logged for each student named.
 */
export const GET = v1({}, async ({ req, ctx }) => {
  const q = new URL(req.url).searchParams;
  const campusId = q.get("campusId");
  const cohortId = q.get("cohortId");
  return { status: 200, body: await listOutcomes(ctx, { ...(campusId ? { campusId } : {}), ...(cohortId ? { cohortId } : {}) }) };
});
