import { listDrives, publishDrive } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = v1({}, async ({ req, ctx }) => {
  const campusId = new URL(req.url).searchParams.get("campusId");
  return { status: 200, body: await listDrives(ctx, campusId ? { campusId } : {}) };
});

/** Paste a drive notice: criteria and scam flags are parsed with rules (0 LLM calls), and the link is never fetched. */
export const POST = v1({ mutation: true, body: "json" }, async ({ ctx, input }) => ({ status: 201, body: await publishDrive(ctx, input) }));
