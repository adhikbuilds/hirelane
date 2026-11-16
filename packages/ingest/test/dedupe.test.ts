import { describe, expect, it } from 'vitest';
import { dedupeJobs, dedupeKey, type DedupeJob } from '../src/dedupe';

const job = (o: Partial<DedupeJob>): DedupeJob => ({
  sourceKind: 'greenhouse', sourceLabel: 'Greenhouse · Trellis', sourceUrl: 'https://boards.greenhouse.io/t/jobs/1',
  company: 'Trellis Cloud Pvt Ltd', title: 'Graduate Engineer', locations: ['Bengaluru, Karnataka, India'], applyUrl: null, hasSalary: false, ...o,
});

describe('dedupeKey', () => {
  it('ignores case, punctuation, company suffixes, batch years and parentheticals', () => {
    expect(dedupeKey('Trellis Cloud Pvt. Ltd.', 'Graduate Engineer (2026 Batch)')).toBe(dedupeKey('TRELLIS CLOUD', 'graduate  engineer'));
  });
  it('keeps different roles apart', () => {
    expect(dedupeKey('A', 'Data Analyst')).not.toBe(dedupeKey('A', 'Data Engineer'));
  });
});

describe('dedupeJobs', () => {
  it('keeps the highest-priority source and records where else it was seen', () => {
    const gh = job({});
    const ld = job({ sourceKind: 'jsonld', sourceLabel: 'careers.trelliscloud.in', sourceUrl: 'https://careers.trelliscloud.in/jobs/1', locations: ['Bangalore, India'] });
    const { kept, dropped } = dedupeJobs([ld, gh]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.sourceKind).toBe('greenhouse');
    expect(kept[0]!.alsoSeenAt).toEqual([{ sourceKind: 'jsonld', sourceLabel: 'careers.trelliscloud.in', sourceUrl: 'https://careers.trelliscloud.in/jobs/1' }]);
    expect(dropped).toHaveLength(1);
  });
  it('same title in different cities is not a duplicate', () => {
    const { kept } = dedupeJobs([job({}), job({ locations: ['Pune, Maharashtra, India'], sourceKind: 'jsonld' })]);
    expect(kept).toHaveLength(2);
  });
  it('a shared apply url (utm ignored) is a duplicate even when the title differs', () => {
    const a = job({ title: 'Software Engineer I', applyUrl: 'https://x.com/apply/1?utm_source=a' });
    const b = job({ title: 'SWE 1', sourceKind: 'zoho_rss', applyUrl: 'https://x.com/apply/1?utm_source=b', locations: ['Pune'] });
    expect(dedupeJobs([a, b]).kept).toHaveLength(1);
  });
  it('among equal priorities prefers the posting that states a salary', () => {
    const a = job({ sourceKind: 'jsonld', sourceUrl: 'https://a/1' });
    const b = job({ sourceKind: 'jsonld', sourceUrl: 'https://a/2', hasSalary: true });
    expect(dedupeJobs([a, b]).kept[0]!.sourceUrl).toBe('https://a/2');
  });
  it('handles empty input and never merges user_shared into an employer posting', () => {
    expect(dedupeJobs([]).kept).toEqual([]);
    const shared = job({ sourceKind: 'user_shared', sourceLabel: 'Shared from Reddit', sourceUrl: 'https://reddit.com/x' });
    const { kept } = dedupeJobs([job({}), shared]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.sourceKind).toBe('greenhouse');
    expect(kept[0]!.alsoSeenAt?.[0]?.sourceKind).toBe('user_shared');
  });
  it('is stable on 10k items', () => {
    const items = Array.from({ length: 10_000 }, (_, i) => job({ title: `Role n${i % 5000}`, sourceUrl: `https://x/${i}` }));
    expect(dedupeJobs(items).kept).toHaveLength(5000);
  });
});
