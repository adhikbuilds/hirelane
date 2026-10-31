import { createCohort, listCohorts } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = v1({}, async ({ req, ctx }) => {
  const campusId = new URL(req.url).searchParams.get("campusId");
  return { status: 200, body: await listCohorts(ctx, campusId ? { campusId } : {}) };
});

export const POST = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => {
  const r = await createCohort(ctx, input);
  return { status: r.created ? 201 : 200, body: r };
});
