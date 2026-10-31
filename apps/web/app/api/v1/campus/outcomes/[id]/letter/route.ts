import { attachLetter, MAX_LETTER_BYTES, ServiceError } from "@hirelane/services";
import { UPLOAD_RATE, v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Optional offer letter: the raw PDF (application/pdf, at most 2 MB), sealed before it is stored. */
export const POST = v1({ mutation: true, body: "raw", rawMax: MAX_LETTER_BYTES, rate: UPLOAD_RATE }, async ({ req, ctx, raw, params }) => {
  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/pdf") throw new ServiceError("bad_file_type", 415);
  return { status: 200, body: await attachLetter(ctx, { id: params["id"] }, raw) };
});
