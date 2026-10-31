import { inviteStaff, listStaff } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Owner only. Staff are listed without email addresses (only a keyed hash of each is stored). */
export const GET = v1({}, async ({ req, ctx }) => {
  const campusId = new URL(req.url).searchParams.get("campusId");
  return { status: 200, body: await listStaff(ctx, campusId ? { campusId } : {}) };
});

/** Owner only. The invitee signs in with the ordinary email code using that address and the invite is claimed on first use. */
export const POST = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => {
  const r = await inviteStaff(ctx, input);
  return { status: r.status === "invited" ? 201 : 200, body: r };
});
