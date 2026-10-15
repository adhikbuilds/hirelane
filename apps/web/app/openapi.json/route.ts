import { buildOpenApi } from "../../lib/openapi";
import { appOrigin } from "../../lib/queries/jobs";
import { CORS_HEADERS } from "../api/public/_lib/http";

export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  return new Response(JSON.stringify(buildOpenApi(appOrigin())), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, s-maxage=3600" },
  });
}
