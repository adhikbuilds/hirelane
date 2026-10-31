import { exportNaac } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** NAAC 5.2.1 shaped CSV of offers by verified students who chose outcomes or full. Formula-injection safe; audited per student. */
export const GET = v1({ rate: { name: "naac-export", max: 10, windowSeconds: 600 } }, async ({ req, ctx }) => {
  const q = new URL(req.url).searchParams;
  const campusId = q.get("campusId");
  const year = q.get("passoutYear");
  const out = await exportNaac(ctx, { ...(campusId ? { campusId } : {}), ...(year ? { passoutYear: Number(year) } : {}) });
  return new Response(out.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": ctx.requestId,
    },
  });
});
