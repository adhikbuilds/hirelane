import { accountsEnabled } from "@/lib/auth/flags";
import { buildOpenApiV1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Like every other /api/v1 route, 404 while the accounts flag is off: the API surface is not published ahead of launch. */
export async function GET(req: Request) {
  if (!(await accountsEnabled())) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const origin = new URL(req.url).origin;
  return Response.json(buildOpenApiV1(origin), { headers: { "Cache-Control": "public, max-age=300" } });
}
