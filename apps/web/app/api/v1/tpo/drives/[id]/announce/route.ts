import { announceDrive } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Step 3: draft to live. 404 when the drive is not a draft of a campus the caller staffs. */
export const POST = v1({ mutation: true }, async ({ ctx, params }) => ({ status: 200, body: await announceDrive(ctx, { id: params["id"] }) }));
