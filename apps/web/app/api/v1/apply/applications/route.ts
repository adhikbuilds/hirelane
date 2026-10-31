import { listApplications } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The tracker: my applications, newest first. ?status= filters, ?limit= caps (1 to 100). */
export const GET = v1({}, async ({ ctx, req }) => {
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const limit = q.get("limit");
  return { status: 200, body: await listApplications(ctx, { ...(status ? { status } : {}), ...(limit ? { limit: Number(limit) } : {}) }) };
});
