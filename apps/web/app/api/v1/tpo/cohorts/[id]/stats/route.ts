import { cohortStats } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Fixed metrics from the latest nightly snapshot; k = 10 over verified members, rounded to 5. `?metric=` names one of them. */
export const GET = v1({}, async ({ req, ctx, params }) => {
  const metric = new URL(req.url).searchParams.get("metric");
  return { status: 200, body: await cohortStats(ctx, { cohortId: params["id"], ...(metric ? { metric } : {}) }) };
});
