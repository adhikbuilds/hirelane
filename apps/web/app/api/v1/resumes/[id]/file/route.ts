import { downloadResume } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Audited download: the file_access_log row is written in the same transaction as the read. */
export const GET = v1({}, async ({ ctx, params, ipHash }) => {
  const f = await downloadResume(ctx, { id: params["id"] }, { ipHash: await ipHash() });
  return new Response(new Uint8Array(f.bytes), {
    status: 200,
    headers: {
      "Content-Type": f.mime,
      "Content-Length": String(f.bytes.length),
      "Content-Disposition": `attachment; filename="${f.fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": ctx.requestId,
    },
  });
});
