import { previewDrive } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Step 1: parse a pasted notice with rules (0 LLM calls). Nothing is saved, the link is never fetched. */
export const POST = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => ({ status: 200, body: await previewDrive(ctx, input) }));
