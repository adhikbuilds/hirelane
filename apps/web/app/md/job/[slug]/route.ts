import { createHash } from "node:crypto";
import { getMarkdownJob } from "@/lib/job-markdown-data";
import { renderJobMarkdown } from "@/lib/job-markdown";
import { isJobSlug } from "@/lib/job-view";
import { appOrigin } from "@/lib/queries/jobs";

/**
 * Markdown representation of /job/{slug}. Internal path: middleware rewrites /job/{slug}.md and
 * `Accept: text/markdown` here, and 404s direct requests to /md/*.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

const BASE_HEADERS = {
  "Content-Type": "text/markdown; charset=utf-8",
  Vary: "Accept",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
} as const;

function notFound(): Response {
  return new Response("# Not found\n\nNo open or closed job has this address.\n", { status: 404, headers: BASE_HEADERS });
}

async function respond(req: Request, ctx: Ctx, head: boolean): Promise<Response> {
  const { slug } = await ctx.params;
  if (!isJobSlug(slug)) return notFound();
  const job = await getMarkdownJob(slug);
  if (!job) return notFound();

  const origin = appOrigin();
  const body = renderJobMarkdown(job, { origin, now: new Date() });
  const etag = `W/"${createHash("sha1").update(body).digest("base64url")}"`;
  const headers = { ...BASE_HEADERS, ETag: etag, Link: `<${origin}/job/${slug}>; rel="canonical"` };

  const inm = req.headers.get("if-none-match");
  if (inm && inm.split(",").some((t) => t.trim() === etag || t.trim() === "*")) return new Response(null, { status: 304, headers });
  return new Response(head ? null : body, { status: 200, headers });
}

export const GET = (req: Request, ctx: Ctx) => respond(req, ctx, false);
export const HEAD = (req: Request, ctx: Ctx) => respond(req, ctx, true);
