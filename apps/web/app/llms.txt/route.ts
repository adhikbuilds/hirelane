import { llmsTxt } from "@/lib/llms";
import { appOrigin } from "@/lib/queries/jobs";

export const dynamic = "force-dynamic";

export const GET = () =>
  new Response(llmsTxt(appOrigin()), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, s-maxage=3600" },
  });
