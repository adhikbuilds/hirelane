import { chunkCount, jobChunkUrls, parseChunkFile, renderUrlset } from "@/lib/sitemap";
import { serveSitemap } from "@/lib/sitemap-http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }): Promise<Response> {
  const i = parseChunkFile((await ctx.params).file);
  if (i === null) return serveSitemap(async () => null);
  return serveSitemap(async (db, origin) => {
    if (i > (await chunkCount(db))) return null;
    return renderUrlset(await jobChunkUrls(db, i, origin));
  });
}
