import { getApplySettings, setAutoApply } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await getApplySettings(ctx) }));

/** "When you swipe right, Hirelane submits for you." On or off at any time; every change is a new consent row. */
export const PUT = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => ({ status: 200, body: await setAutoApply(ctx, input) }));
