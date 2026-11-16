import { saveDriveDraft } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Step 2: save the parsed notice as a draft that students cannot see. */
export const POST = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => ({ status: 200, body: await saveDriveDraft(ctx, input) }));
