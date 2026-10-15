import { companyUrls, renderUrlset } from "@/lib/sitemap";
import { serveSitemap } from "@/lib/sitemap-http";

export const dynamic = "force-dynamic";

export const GET = () => serveSitemap(async (db, origin) => renderUrlset(await companyUrls(db, origin)));
