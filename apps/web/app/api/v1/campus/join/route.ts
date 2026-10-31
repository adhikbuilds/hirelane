import { joinByCode } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Join with the campus code. Without cohortId it checks the code and lists the cohorts; with one it joins. Rate limited per
 * user, per client address and globally inside the database; a code join is unverified and never counts toward a TPO's k.
 */
export const POST = v1({ mutation: true, body: "json", rate: { name: "campus-join", max: 20, windowSeconds: 600 } }, async ({ ctx, input, ipHash }) => ({
  status: 200,
  body: await joinByCode(ctx, input, { ipHash: await ipHash() }),
}));
