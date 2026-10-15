import { appOrigin } from "@/lib/queries/jobs";
import { robotsTxt } from "@/lib/robots";

export const dynamic = "force-dynamic";

export const GET = () =>
  new Response(robotsTxt(appOrigin()), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=3600" },
  });
