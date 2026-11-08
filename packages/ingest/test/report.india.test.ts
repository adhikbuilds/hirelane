import { describe, expect, it } from 'vitest';
import { cityOf, freshness, isFresherFriendly, summarizeIndia, type IndiaJobRow } from '../src/report/india';

const NOW = new Date('2026-11-06T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const row = (o: Partial<IndiaJobRow> = {}): IndiaJobRow => ({
  company: 'Acme',
  title: 'Software Engineer',
  level: 'mid',
  locations: { all: ['Bengaluru, India'], perLocation: [{ part: 'Bengaluru, India', country: 'IN' }] },
  sourceKind: 'greenhouse',
  sourceLabel: 'Greenhouse · Acme',
  postedAt: null,
  firstSeenAt: day(1),
  ...o,
});

describe('cityOf', () => {
  it('canonicalises aliases', () => {
    expect(cityOf({ all: ['Bangalore, KA'], perLocation: [{ part: 'Bangalore, KA', country: 'IN' }] })).toBe('Bengaluru');
    expect(cityOf({ all: ['Gurgaon'], perLocation: [{ part: 'Gurgaon', country: 'IN' }] })).toBe('Gurugram');
  });
  it('ignores non-India parts and falls back to Other India / Remote', () => {
    expect(cityOf({ all: ['London', 'Pune'], perLocation: [{ part: 'London', country: 'GB' }, { part: 'Pune', country: 'IN' }] })).toBe('Pune');
    expect(cityOf({ all: ['India'], perLocation: [{ part: 'India', country: 'IN' }] })).toBe('Other India');
    expect(cityOf({ all: ['Remote - India'], perLocation: [{ part: 'Remote - India', country: 'IN', remote: true }] })).toBe('Remote (India)');
  });
  it('tolerates null and garbage', () => {
    expect(cityOf(null)).toBe('Other India');
    expect(cityOf({})).toBe('Other India');
    expect(cityOf('x')).toBe('Other India');
  });
});

describe('isFresherFriendly', () => {
  it('uses level and title keywords', () => {
    expect(isFresherFriendly('entry', 'Engineer')).toBe(true);
    expect(isFresherFriendly('intern', 'Engineer')).toBe(true);
    expect(isFresherFriendly('senior', 'Graduate Trainee')).toBe(true);
    expect(isFresherFriendly('senior', 'Senior Engineer')).toBe(false);
    expect(isFresherFriendly(null, 'Fresher - Support')).toBe(true);
    expect(isFresherFriendly(null, 'Undergraduate Tutor')).toBe(false);
  });
});

describe('freshness', () => {
  it('buckets by posted_at, else first_seen_at', () => {
    expect(freshness(row({ firstSeenAt: day(2) }), NOW)).toBe('<=7d');
    expect(freshness(row({ firstSeenAt: day(20) }), NOW)).toBe('8-30d');
    expect(freshness(row({ firstSeenAt: day(60) }), NOW)).toBe('31-90d');
    expect(freshness(row({ firstSeenAt: day(200) }), NOW)).toBe('>90d');
    expect(freshness(row({ postedAt: day(3), firstSeenAt: day(200) }), NOW)).toBe('<=7d');
  });
  it('treats future dates as the freshest bucket', () => {
    expect(freshness(row({ firstSeenAt: day(-1) }), NOW)).toBe('<=7d');
  });
});

describe('summarizeIndia', () => {
  it('handles empty input', () => {
    const s = summarizeIndia([], { now: NOW, since: day(1) });
    expect(s.total).toBe(0);
    expect(s.topNewEmployers).toEqual([]);
  });
  it('breaks down and ranks new employers', () => {
    const rows = [
      row({ company: 'A', firstSeenAt: day(0.5) }),
      row({ company: 'A', firstSeenAt: day(0.5), level: 'entry' }),
      row({ company: 'B', firstSeenAt: day(0.5), sourceKind: 'jsonld', sourceLabel: 'careers.b.in' }),
      row({ company: 'C', firstSeenAt: day(40) }),
    ];
    const s = summarizeIndia(rows, { now: NOW, since: day(1) });
    expect(s.total).toBe(4);
    expect(s.byCity).toEqual([{ key: 'Bengaluru', n: 4 }]);
    expect(s.fresherFriendly).toBe(1);
    expect(s.bySource).toEqual([{ key: 'greenhouse', n: 3 }, { key: 'jsonld', n: 1 }]);
    expect(s.byFreshness).toEqual({ '<=7d': 3, '8-30d': 0, '31-90d': 1, '>90d': 0 });
    expect(s.newTotal).toBe(3);
    expect(s.topNewEmployers).toEqual([{ company: 'A', n: 2 }, { company: 'B', n: 1 }]);
  });
  it('caps top employers at 20 and breaks ties by name', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ company: `Co${String(i).padStart(2, '0')}`, firstSeenAt: day(0.1) }));
    const s = summarizeIndia(rows, { now: NOW, since: day(1) });
    expect(s.topNewEmployers).toHaveLength(20);
    expect(s.topNewEmployers[0]!.company).toBe('Co00');
  });
});
