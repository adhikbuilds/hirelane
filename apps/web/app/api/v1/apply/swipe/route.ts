import { swipeRight } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Per-student limit on swipes (decision 2026-10-31, docs/apply.md "Open before pilot" 2): 20 a minute and a bucket of its own,
 * apart from the general write budget. A burst of swipes is also a burst of queued submits; the daily cap, not this, bounds what is sent.
 */
export const SWIPE_RATE = { name: "apply-swipe", max: 20, windowSeconds: 60 };

/** Right swipe = applied. Creates the application with a 4 second undo window and queues the submit; the worker decides what is sent. */
export const POST = v1({ mutation: true, body: "json", rate: SWIPE_RATE }, async ({ ctx, input }) => {
  const r = await swipeRight(ctx, input);
  return { status: r.application.created ? 201 : 200, body: r };
});
