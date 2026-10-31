import { verifyOutcome } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = v1({ mutation: true }, async ({ ctx, params }) => ({ status: 200, body: await verifyOutcome(ctx, { id: params["id"] }) }));
