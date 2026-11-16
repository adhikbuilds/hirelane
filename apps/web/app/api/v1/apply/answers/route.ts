import { listAnswers, saveAnswer } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await listAnswers(ctx) }));

/** Create or replace the answer for a question key. */
export const PUT = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => ({ status: 200, body: await saveAnswer(ctx, input) }));
