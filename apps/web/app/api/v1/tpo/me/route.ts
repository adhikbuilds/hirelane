import { tpoMe } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The campuses I staff (empty for anyone else). Console sign-in is the ordinary email-code sign-in; a staff session is any
 * session with a tpo_members row, and any pending invite for my verified mailbox is claimed here.
 */
export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await tpoMe(ctx) }));
