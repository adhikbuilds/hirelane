/**
 * Sitemap index and chunks (design section 7). Builders are pure; readers take a client so tests can use a scratch database.
 * Only open jobs are listed. `lastmod` is jobs.content_updated_at, which a re-check alone never moves.
 */
import { isPublished, LISTS, facetKeyOf } from "./lists";
import { facetCounts, latestSuccessfulRunAt } from "./lists-data";
import type { Queryable } from "./queries/jobs";

/** URLs per file: the protocol maximum. */
export const CHUNK = 50_000;
const MAX_CHUNK_FILES = 9999;

export type SitemapUrl = { loc: string; lastmod?: Date | null };
export type IndexEntry = { loc: string; lastmod: Date | null };

export function xmlEscape(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const formatLastmod = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

const NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

export function renderUrlset(urls: readonly SitemapUrl[]): string {
  if (urls.length > CHUNK) throw new Error(`a sitemap file holds at most ${CHUNK} URLs, got ${urls.length} (limit is 50000)`);
  const body = urls
    .map((u) => `<url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${formatLastmod(u.lastmod)}</lastmod>` : ""}</url>`)
    .join("\n");
  return `${HEAD}<urlset xmlns="${NS}">\n${body}\n</urlset>\n`;
}

export function renderIndex(entries: readonly IndexEntry[]): string {
  const body = entries
    .map((e) => `<sitemap><loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `<lastmod>${formatLastmod(e.lastmod)}</lastmod>` : ""}</sitemap>`)
    .join("\n");
  return `${HEAD}<sitemapindex xmlns="${NS}">\n${body}\n</sitemapindex>\n`;
}

/** "3.xml" to 3. Anything but a plain 1-based number is null, so the route can 404. */
export function parseChunkFile(file: string): number | null {
  const m = /^([1-9]\d{0,3})\.xml$/.exec(file);
  return m ? Number(m[1]) : null;
}

export async function chunkCount(db: Queryable, chunk: number = CHUNK): Promise<number> {
  const { rows } = await db.query("SELECT count(*)::int AS n FROM jobs WHERE closed_at IS NULL");
  const n = Number(rows[0]?.n ?? 0);
  return Math.min(MAX_CHUNK_FILES, Math.max(1, Math.ceil(n / chunk)));
}

/** Chunk `i` (1-based): open jobs ordered by primary key, so membership is stable while the data is. */
export async function jobChunkUrls(db: Queryable, i: number, origin: string, chunk: number = CHUNK): Promise<SitemapUrl[]> {
  const { rows } = await db.query(
    `SELECT slug, content_updated_at FROM jobs WHERE closed_at IS NULL ORDER BY id LIMIT $1 OFFSET $2`,
    [chunk, (i - 1) * chunk],
  );
  return rows.map((r) => ({ loc: `${origin}/job/${encodeURIComponent(r.slug)}`, lastmod: new Date(r.content_updated_at) }));
}

export async function companyUrls(db: Queryable, origin: string): Promise<SitemapUrl[]> {
  const { rows } = await db.query(
    `SELECT c.slug, max(j.content_updated_at) AS lastmod
       FROM jobs j JOIN companies c ON c.id = j.company_id
      WHERE j.closed_at IS NULL
      GROUP BY c.slug ORDER BY c.slug`,
  );
  return rows.map((r) => ({ loc: `${origin}/company/${encodeURIComponent(r.slug)}`, lastmod: new Date(r.lastmod) }));
}

/** `/lists` plus every published list (job_facets n >= MIN_PUBLISHED). */
export async function listUrls(db: Queryable, origin: string): Promise<SitemapUrl[]> {
  const [counts, ran] = await Promise.all([facetCounts(db), latestSuccessfulRunAt(db)]);
  const urls: SitemapUrl[] = [{ loc: `${origin}/lists`, lastmod: ran }];
  for (const def of LISTS) {
    if (isPublished(counts.get(facetKeyOf(def)))) urls.push({ loc: `${origin}/lists/${def.slug}`, lastmod: ran });
  }
  return urls;
}

export async function indexEntries(db: Queryable, origin: string, chunk: number = CHUNK): Promise<IndexEntry[]> {
  const n = await chunkCount(db, chunk);
  const ran = await latestSuccessfulRunAt(db);
  const entries: IndexEntry[] = [];
  for (let i = 1; i <= n; i++) {
    const { rows } = await db.query(
      `SELECT max(content_updated_at) AS m FROM (
         SELECT content_updated_at FROM jobs WHERE closed_at IS NULL ORDER BY id LIMIT $1 OFFSET $2) s`,
      [chunk, (i - 1) * chunk],
    );
    entries.push({ loc: `${origin}/sitemaps/jobs/${i}.xml`, lastmod: rows[0]?.m ? new Date(rows[0].m) : null });
  }
  entries.push({ loc: `${origin}/sitemaps/companies.xml`, lastmod: ran });
  entries.push({ loc: `${origin}/sitemaps/lists.xml`, lastmod: ran });
  return entries;
}
