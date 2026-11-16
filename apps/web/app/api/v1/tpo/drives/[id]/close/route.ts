import { closeDrive } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** End a drive. 404 when it is already closed or is not the caller's. */
export const POST = v1({ mutation: true }, async ({ ctx, params }) => ({ status: 200, body: await closeDrive(ctx, { id: params["id"] }) }));
