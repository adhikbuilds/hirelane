import { setShareLevel } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** aggregate (default) | outcomes | full. Every change is also a consent row. */
export const PUT = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => ({ status: 200, body: await setShareLevel(ctx, input) }));
