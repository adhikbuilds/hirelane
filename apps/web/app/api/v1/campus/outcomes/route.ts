import { listMyOutcomes, reportOutcome } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await listMyOutcomes(ctx) }));

/** "I got an interview / an offer." Student-reported until a TPO verifies it. */
export const POST = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => ({ status: 201, body: await reportOutcome(ctx, input) }));
