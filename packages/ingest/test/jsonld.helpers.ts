import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BoardFetch } from '../src/contract';

const DIR = fileURLToPath(new URL('../fixtures/jsonld/', import.meta.url));
export const jf = (name: string): string => readFileSync(DIR + name, 'utf8');

export const HOST = 'careers.trelliscloud.in';
export const B = `https://${HOST}`;

export const SITE: Record<string, { status?: number; body: string; headers?: Record<string, string> }> = {
  [`${B}/robots.txt`]: { body: jf('robots.txt') },
  [`${B}/sitemap-index.xml`]: { body: jf('sitemap-index.xml') },
  [`${B}/sitemap-jobs.xml`]: { body: jf('sitemap-jobs.xml') },
  [`${B}/sitemap-blog.xml`]: { body: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>' },
  [`${B}/jobs/graduate-engineer-bengaluru`]: { body: jf('job-graduate-engineer-bengaluru.html') },
  [`${B}/jobs/support-associate-remote?ref=a&b=1`]: { body: jf('job-support-associate-remote.html') },
  [`${B}/jobs/data-analyst-chicago`]: { body: jf('job-data-analyst-chicago.html') },
  [`${B}/jobs/old-role-expired`]: { body: jf('job-old-role-expired.html') },
  [`${B}/jobs/no-markup`]: { body: jf('job-no-markup.html') },
};

export interface SiteFetch {
  fetch: BoardFetch;
  urls: string[];
}

/** Serves SITE (plus overrides) and records every requested URL; anything else is a 404. */
export function siteFetch(overrides: typeof SITE = {}): SiteFetch {
  const table = { ...SITE, ...overrides };
  const urls: string[] = [];
  const fetch: BoardFetch = async (url) => {
    urls.push(url);
    const hit = table[url];
    if (!hit) return new Response('nope', { status: 404 });
    return new Response(hit.body, { status: hit.status ?? 200, headers: hit.headers ?? {} });
  };
  return { fetch, urls };
}
