import { getEligibility, saveEligibility } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: { eligibility: await getEligibility(ctx) } }));
export const PUT = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => ({ status: 200, body: await saveEligibility(ctx, input) }));
