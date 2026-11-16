import { listApplications, swipeRight } from "@hirelane/services";
import { v1, APPLY_RATE } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The tracker: my applications, newest first. ?status= filters, ?limit= caps (1 to 100). */
export const GET = v1({}, async ({ ctx, req }) => {
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const limit = q.get("limit");
  return { status: 200, body: await listApplications(ctx, { ...(status ? { status } : {}), ...(limit ? { limit: Number(limit) } : {}) }) };
});

/** Apply: creates the application with a 4 second undo window and queues the submit; the worker decides what is sent. */
export const POST = v1({ mutation: true, body: "json", rate: APPLY_RATE }, async ({ ctx, input }) => {
  const r = await swipeRight(ctx, input);
  return { status: r.application.created ? 201 : 200, body: r };
});
