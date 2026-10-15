import "server-only";
import { withAdmin } from "@hirelane/db";
import type { Queryable } from "./queries/jobs";
import { appOrigin } from "./queries/jobs";

export const SITEMAP_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
  "X-Content-Type-Options": "nosniff",
} as const;

export const sitemapResponse = (xml: string): Response => new Response(xml, { status: 200, headers: SITEMAP_HEADERS });
export const sitemapNotFound = (): Response => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/** Runs one reader against the database and renders it. Never leaks error text. */
export async function serveSitemap(render: (db: Queryable, origin: string) => Promise<string | null>): Promise<Response> {
  try {
    const xml = await withAdmin((db) => render(db, appOrigin()));
    return xml === null ? sitemapNotFound() : sitemapResponse(xml);
  } catch {
    return new Response("Sitemap unavailable", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "300" } });
  }
}
