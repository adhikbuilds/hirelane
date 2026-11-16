import { checkPastedJob } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Paste a job from outside (a WhatsApp forward, a Naukri listing) and get fit, eligibility with the maths, and a scam check.
 * It writes nothing and fetches nothing: the link, if any, is read as text. Origin-checked like a mutation, but not
 * idempotency-keyed, because there is nothing to replay. 20 pastes per 10 minutes per student: a person reading forwards,
 * not a script (tighter than the shared write class of 40 a minute).
 */
export const POST = v1({ mutation: true, idempotent: false, body: "json", rate: { name: "paste", max: 20, windowSeconds: 600 } }, async ({ ctx, input }) => ({
  status: 200,
  body: await checkPastedJob(ctx, input),
}));
