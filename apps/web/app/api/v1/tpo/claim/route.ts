import { claimStaffInvites } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Takes the staff seat of any pending invite for my verified mailbox. The only place an invite is claimed. Idempotent. */
export const POST = v1({ mutation: true }, async ({ ctx }) => ({ status: 200, body: await claimStaffInvites(ctx) }));
