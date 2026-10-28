import { parseInput } from "@hirelane/services";
import { v1 } from "@/lib/http";
import { ConsentInput } from "@/lib/http/me-inputs";
import { recordConsent } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Append-only: a withdrawal is a new row with granted=false. */
export const POST = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => {
  const c = parseInput(ConsentInput, input);
  await recordConsent(ctx.userId, c.kind, c.granted);
  return { status: 200, body: { ok: true } };
});
