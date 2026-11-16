import { verifyEmailJoin } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Prove the college mailbox with the code and take a verified seat in the chosen cohort. One mailbox, one seat. */
export const POST = v1({ mutation: true, body: "json", rate: { name: "campus-email-verify", max: 20, windowSeconds: 600 } }, async ({ ctx, input, ipHash }) => ({
  status: 200,
  body: await verifyEmailJoin(ctx, input, { ipHash: await ipHash() }),
}));
