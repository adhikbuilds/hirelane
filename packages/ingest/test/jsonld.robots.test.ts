import { describe, expect, it } from 'vitest';
import { parseRobots } from '../src/jsonld/robots';
import { jf } from './jsonld.helpers';

describe('parseRobots', () => {
  const r = parseRobots(jf('robots.txt'));

  it('lists every Sitemap line', () => {
    expect(r.sitemaps).toEqual(['https://careers.trelliscloud.in/sitemap-index.xml', 'https://elsewhere.example.com/other-sitemap.xml']);
  });
  it('honours Disallow for the * group and Allow overrides by longest match', () => {
    expect(r.isAllowed('/admin/x')).toBe(false);
    expect(r.isAllowed('/jobs/graduate')).toBe(true);
    expect(r.isAllowed('/jobs/internal-referral-only')).toBe(false);
    expect(r.isAllowed('/search?q=a')).toBe(false);
    expect(r.isAllowed('/about-us')).toBe(true);
  });
  it('reads Crawl-delay in ms', () => {
    expect(r.crawlDelayMs).toBe(2000);
  });
  it('prefers a group that names our bot over *', () => {
    const t = 'User-agent: *\nDisallow: /\n\nUser-agent: HirelaneBot\nDisallow: /private\n';
    const x = parseRobots(t);
    expect(x.isAllowed('/jobs')).toBe(true);
    expect(x.isAllowed('/private/a')).toBe(false);
  });
  it('treats Disallow: / for * as total block and empty Disallow as allow-all', () => {
    expect(parseRobots('User-agent: *\nDisallow: /').isAllowed('/jobs/1')).toBe(false);
    expect(parseRobots('User-agent: *\nDisallow:').isAllowed('/jobs/1')).toBe(true);
  });
  it('supports * and $ patterns', () => {
    const x = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /a*/tmp');
    expect(x.isAllowed('/files/cv.pdf')).toBe(false);
    expect(x.isAllowed('/files/cv.pdf?x=1')).toBe(true);
    expect(x.isAllowed('/abc/tmp')).toBe(false);
  });
  it('allows everything for empty or junk input and wins ties for Allow', () => {
    expect(parseRobots('').isAllowed('/x')).toBe(true);
    expect(parseRobots('<html>not robots</html>').isAllowed('/x')).toBe(true);
    expect(parseRobots('User-agent: *\nDisallow: /a\nAllow: /a').isAllowed('/a')).toBe(true);
  });
  it('merges consecutive User-agent lines into one group', () => {
    const x = parseRobots('User-agent: foo\nUser-agent: hirelanebot\nDisallow: /z\n');
    expect(x.isAllowed('/z')).toBe(false);
  });
});
