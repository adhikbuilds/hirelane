import { undoApplication } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Take an application back within 4 seconds. After that the answer is 409 undo_window_closed. */
export const POST = v1({ mutation: true }, async ({ ctx, params }) => ({ status: 200, body: await undoApplication(ctx, { id: params["id"] }) }));
