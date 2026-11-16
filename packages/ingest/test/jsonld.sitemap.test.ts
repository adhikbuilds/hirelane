import { describe, expect, it } from 'vitest';
import { parseSitemap } from '../src/jsonld/sitemap';
import { jf } from './jsonld.helpers';

describe('parseSitemap', () => {
  it('reads a sitemap index', () => {
    const s = parseSitemap(jf('sitemap-index.xml'));
    expect(s.kind).toBe('index');
    expect(s.entries.map((e) => e.loc)).toEqual([
      'https://careers.trelliscloud.in/sitemap-jobs.xml',
      'https://careers.trelliscloud.in/sitemap-blog.xml',
    ]);
    expect(s.entries[0]!.lastmod).toBe('2026-11-01');
  });
  it('reads a urlset, decoding entities and CDATA', () => {
    const s = parseSitemap(jf('sitemap-jobs.xml'));
    expect(s.kind).toBe('urlset');
    expect(s.entries).toHaveLength(9);
    expect(s.entries[1]!.loc).toBe('https://careers.trelliscloud.in/jobs/support-associate-remote?ref=a&b=1');
    expect(s.entries[2]!.loc).toBe('https://careers.trelliscloud.in/jobs/data-analyst-chicago');
    expect(s.entries[0]!.lastmod).toBe('2026-11-02');
  });
  it('returns an empty urlset for junk', () => {
    expect(parseSitemap('<html></html>')).toEqual({ kind: 'urlset', entries: [] });
    expect(parseSitemap('')).toEqual({ kind: 'urlset', entries: [] });
  });
});
