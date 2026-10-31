import { exportNaac, previewNaac } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

const RATE = { name: "naac-export", max: 10, windowSeconds: 600 };

const params = (req: Request) => {
  const q = new URL(req.url).searchParams;
  const campusId = q.get("campusId");
  const year = q.get("passoutYear");
  return { ...(campusId ? { campusId } : {}), ...(year ? { passoutYear: Number(year) } : {}) };
};

/** What the export would hold: a row count, the file name and the column headers. No student is named and nothing is written. */
export const GET = v1({}, async ({ req, ctx }) => ({ status: 200, body: await previewNaac(ctx, params(req)) }));

/**
 * NAAC 5.2.1 shaped CSV of offers by verified students who chose outcomes or full. Formula-injection safe. An explicit action:
 * the audit row for each student is written in the same call. No Idempotency-Key, so no stored copy of the file.
 */
export const POST = v1({ mutation: true, idempotent: false, rate: RATE }, async ({ req, ctx }) => {
  const out = await exportNaac(ctx, params(req));
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
