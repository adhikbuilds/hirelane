import { driveReach } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Qualify and could-not-check counts from the nightly snapshot; pending until one exists. k >= 10 is applied by the database. */
export const GET = v1({}, async ({ ctx, params }) => ({ status: 200, body: await driveReach(ctx, { id: params["id"] }) }));
