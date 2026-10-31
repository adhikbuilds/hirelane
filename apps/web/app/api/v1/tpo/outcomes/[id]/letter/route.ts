import { outcomeLetter } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The sealed offer letter, only when the student shared at outcomes/full AND consented to offer_letter_tpo. An explicit action
 * (POST), not a read: the view is written to the student's access log in the same call. No Idempotency-Key, so no stored copy.
 */
export const POST = v1({ mutation: true, idempotent: false }, async ({ ctx, params }) => {
  const f = await outcomeLetter(ctx, { id: params["id"] });
  return new Response(new Uint8Array(f.bytes), {
    status: 200,
    headers: {
      "Content-Type": f.mime,
      "Content-Length": String(f.bytes.length),
      "Content-Disposition": 'attachment; filename="offer-letter.pdf"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": ctx.requestId,
    },
  });
});
