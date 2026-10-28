import { saveBuilderStep } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => ({ status: 200, body: await saveBuilderStep(ctx, input) }));
