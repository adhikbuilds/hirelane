import { listInbox, markInboxRead } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await listInbox(ctx) }));

/** Mark every notification read. */
export const PUT = v1({ mutation: true }, async ({ ctx }) => ({ status: 200, body: await markInboxRead(ctx) }));
