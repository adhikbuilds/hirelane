import { listResumes, MAX_RESUME_BYTES, uploadResume } from "@hirelane/services";
import { UPLOAD_RATE, v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: { resumes: await listResumes(ctx) } }));

/**
 * Upload. The body is the raw file (not multipart): Content-Type is the file's MIME type, `X-File-Name` is its
 * URL-encoded name (kept only sealed). Capped at 5 MB by Content-Length and again on the stream; magic bytes checked.
 */
export const POST = v1({ mutation: true, body: "raw", rawMax: MAX_RESUME_BYTES, rate: UPLOAD_RATE }, async ({ req, ctx, raw }) => {
  const mime = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  let fileName: string | null = null;
  const h = req.headers.get("x-file-name");
  if (h) {
    try {
      fileName = decodeURIComponent(h).slice(0, 255);
    } catch {
      fileName = null;
    }
  }
  const label = new URL(req.url).searchParams.get("label");
  const out = await uploadResume(ctx, { mime, fileName, ...(label ? { label } : {}) }, raw);
  return { status: 202, body: out };
});
