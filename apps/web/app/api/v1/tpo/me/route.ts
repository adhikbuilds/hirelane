import { tpoMe } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The campuses I staff (empty for anyone else), and whether an invite for my verified mailbox is waiting. Writes nothing:
 * the invitee takes the seat with POST /api/v1/tpo/claim (decision 2026-10-31, docs/campus.md section 8).
 */
export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await tpoMe(ctx) }));
