import { ServiceError } from "@hirelane/services";

/** Reads at most `max` bytes. Content-Length is checked first, then the stream is cut off the moment the cap is crossed. */
export async function readCapped(req: Request, max: number): Promise<Buffer> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d{1,12}$/.test(declared)) throw new ServiceError("bad_content_length", 400);
    if (Number(declared) > max) throw new ServiceError("file_too_large", 413);
  }
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new ServiceError("file_too_large", 413);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}
