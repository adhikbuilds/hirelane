import { importRoster, MAX_ROSTER_BYTES, ServiceError } from "@hirelane/services";
import { UPLOAD_RATE, v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Cohort CSV import: the raw CSV (text/csv, at most 1 MB) with an email column and an optional placed column. Only email hashes and the placed flag are kept. */
export const POST = v1({ mutation: true, body: "raw", rawMax: MAX_ROSTER_BYTES, rate: UPLOAD_RATE }, async ({ req, ctx, raw, params }) => {
  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!["text/csv", "application/csv", "text/plain"].includes(type)) throw new ServiceError("bad_file_type", 415);
  return { status: 200, body: await importRoster(ctx, { cohortId: params["id"] }, raw) };
});
