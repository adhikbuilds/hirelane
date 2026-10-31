import { listAccessLog } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Every time a placement cell read something about me (outcome lists, NAAC exports, letter views, verifications). */
export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await listAccessLog(ctx) }));
