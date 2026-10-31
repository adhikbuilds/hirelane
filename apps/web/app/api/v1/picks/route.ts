import { getPicks } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Today's ranked roles for the signed-in student: hard eligibility fails never appear, unknown rules show with their reason. Own data only; nothing is stored. */
export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await getPicks(ctx) }));
