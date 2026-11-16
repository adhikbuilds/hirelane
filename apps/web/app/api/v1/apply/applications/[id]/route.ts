import { getApplication } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** One application: the answers used (and which need me), the receipt, and the employer messages matched to it. */
export const GET = v1({}, async ({ ctx, params }) => ({ status: 200, body: await getApplication(ctx, { id: params["id"] }) }));
