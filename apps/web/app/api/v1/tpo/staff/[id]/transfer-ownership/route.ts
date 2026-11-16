import { transferOwnership } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Owner only (anyone else gets 404). Hands ownership to a claimed staff member of the same campus; the caller becomes staff. */
export const POST = v1({ mutation: true, body: "json" }, async ({ ctx, params, input }) => {
  const body = (input ?? {}) as Record<string, unknown>;
  return { status: 200, body: await transferOwnership(ctx, { ...body, memberId: params["id"] }) };
});
