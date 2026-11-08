/** sitemap.xml / sitemapindex parser. Regex based, no XML engine, no entity expansion beyond the five XML entities. Pure. */

export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}
export interface Sitemap {
  kind: 'index' | 'urlset';
  entries: SitemapEntry[];
}

const unxml = (s: string): string => {
  const t = s.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(t);
  const v = cdata ? cdata[1]! : t;
  return v.replace(/&(amp|lt|gt|quot|apos);/g, (_, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[n]!).trim();
};

function entries(xml: string, tag: 'url' | 'sitemap'): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  const blockRe = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  for (let m = blockRe.exec(xml); m; m = blockRe.exec(xml)) {
    const loc = /<loc\b[^>]*>([\s\S]*?)<\/loc>/i.exec(m[1]!);
    if (!loc) continue;
    const lm = /<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i.exec(m[1]!);
    const l = unxml(loc[1]!);
    if (l) out.push({ loc: l, lastmod: lm ? unxml(lm[1]!) || null : null });
  }
  return out;
}

export function parseSitemap(xml: string): Sitemap {
  if (/<sitemapindex\b/i.test(xml)) return { kind: 'index', entries: entries(xml, 'sitemap') };
  return { kind: 'urlset', entries: entries(xml, 'url') };
}
