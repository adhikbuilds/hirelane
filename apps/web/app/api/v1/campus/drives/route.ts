import { listMyDrives } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** My drive inbox: drives for my cohort that I am eligible for or not yet known to fail. */
export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await listMyDrives(ctx) }));
