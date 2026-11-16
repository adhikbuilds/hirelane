import { driveCounts } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Eligible / unknown / ineligible counts for a drive, from the nightly snapshot, with the same suppression as cohort stats. */
export const GET = v1({}, async ({ ctx, params }) => ({ status: 200, body: await driveCounts(ctx, { id: params["id"] }) }));
