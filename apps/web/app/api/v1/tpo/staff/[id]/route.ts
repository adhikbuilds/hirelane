import { removeStaff } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Owner only (anyone else gets 404). Removes a staff seat or an open invite; the last owner cannot be removed (409). */
export const DELETE = v1({ mutation: true }, async ({ req, ctx, params }) => {
  const campusId = new URL(req.url).searchParams.get("campusId");
  return { status: 200, body: await removeStaff(ctx, { memberId: params["id"], ...(campusId ? { campusId } : {}) }) };
});
