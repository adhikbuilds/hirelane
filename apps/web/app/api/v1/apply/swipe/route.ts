import { swipeRight } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Right swipe = applied. Creates the application with a 4 second undo window and queues the submit; the worker decides what is sent. */
export const POST = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => {
  const r = await swipeRight(ctx, input);
  return { status: r.application.created ? 201 : 200, body: r };
});
