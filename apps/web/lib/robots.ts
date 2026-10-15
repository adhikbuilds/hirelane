/** robots.txt body. The public API and the board stay crawlable; internal and private paths do not. */
export function robotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Allow: /api/public/",
    "Disallow: /api/",
    "Disallow: /ops/",
    "Disallow: /applications",
    "Disallow: /triage",
    "Disallow: /md/",
    "",
    `Sitemap: ${origin.replace(/\/+$/, "")}/sitemap.xml`,
    "",
  ].join("\n");
}
