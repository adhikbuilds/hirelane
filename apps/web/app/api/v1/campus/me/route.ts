import { getMyCampus, leaveCampus } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** My campus membership (campus, cohort, share level, whether I count as verified), or null. */
export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await getMyCampus(ctx) }));

/** Leave the campus. My outcomes stay mine; the TPO stops seeing them. */
export const DELETE = v1({ mutation: true }, async ({ ctx }) => ({ status: 200, body: await leaveCampus(ctx) }));
