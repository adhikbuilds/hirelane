import { fileOutboxCampusMail, startEmailJoin } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Mail a six-digit code (OTP purpose campus_email) to an address on a domain registered for a campus. */
export const POST = v1({ mutation: true, body: "json", rate: { name: "campus-email-send", max: 10, windowSeconds: 600 } }, async ({ ctx, input, ipHash }) => ({
  status: 200,
  body: await startEmailJoin(ctx, input, fileOutboxCampusMail(), { ipHash: await ipHash() }),
}));
