import { buildOpenApiV1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return Response.json(buildOpenApiV1(origin), { headers: { "Cache-Control": "public, max-age=300" } });
}
