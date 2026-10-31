import { rearmApplication } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Own application only (someone else's is 404). Only one blocked on a needs_you question can be re-armed; other blocks are 409. */
export const POST = v1({ mutation: true }, async ({ ctx, params }) => ({ status: 200, body: await rearmApplication(ctx, { id: params["id"] }) }));
