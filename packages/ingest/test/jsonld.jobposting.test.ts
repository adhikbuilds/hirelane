import { describe, expect, it } from 'vitest';
import { detectIndia } from '../src/jsonld/india';
import { parseJobPosting } from '../src/jsonld/jobposting';
import { extractJobPostings } from '../src/jsonld/extract';
import { B, jf } from './jsonld.helpers';

const NOW = new Date('2026-11-06T00:00:00Z');
const parse = (file: string, path: string) => {
  const [jp] = extractJobPostings(jf(file));
  return parseJobPosting(jp!, { pageUrl: `${B}${path}`, host: 'careers.trelliscloud.in', now: NOW });
};

describe('parseJobPosting', () => {
  it('maps the Bengaluru graduate role, with salary and India detection', () => {
    const r = parse('job-graduate-engineer-bengaluru.html', '/jobs/graduate-engineer-bengaluru');
    if (r.kind !== 'ok') throw new Error(r.kind);
    const p = r.posting;
    expect(p.ats).toBe('jsonld');
    expect(p.boardToken).toBe('careers.trelliscloud.in');
    expect(p.externalId).toBe('TC-1001');
    expect(p.title).toBe('Graduate Engineer (2026 batch)');
    expect(p.url).toBe(`${B}/jobs/graduate-engineer-bengaluru`);
    expect(p.applyUrl).toBe(`${B}/apply/TC-1001`);
    expect(p.locationsRaw).toEqual(['Bengaluru, Karnataka, India']);
    expect(p.employmentRaw).toBe('Full-time, Internship');
    expect(p.postedAt).toBe('2026-11-02T00:00:00.000Z');
    expect(p.validThrough).toBe('2027-01-31T23:59:00.000Z');
    expect(p.department).toBe('Engineering');
    expect(p.descriptionHtml).toBe('<p>Join our <b>Bengaluru</b> team. Freshers welcome.</p>');
    expect(p.isRemoteHint).toBeNull();
    expect(p.compensation).toEqual({
      min: 400000, max: 600000, currency: 'INR', interval: 'year', kind: 'salary', summaryText: null, source: 'jsonld.baseSalary',
    });
    expect(r.india).toEqual({ isIndia: true, reason: 'country' });
    expect(r.company).toBe('Trellis Cloud');
  });

  it('remote roles: TELECOMMUTE hint, India requirement, no salary when baseSalary is absent', () => {
    const r = parse('job-support-associate-remote.html', '/jobs/support-associate-remote?ref=a&b=1');
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.posting.isRemoteHint).toBe(true);
    expect(r.posting.workplaceRaw).toBe('remote');
    expect(r.posting.compensation).toBeNull();
    expect(r.posting.externalId).toBe('TC-2002');
    expect(r.posting.locationsRaw).toEqual(['India']);
    expect(r.posting.postedAt).toBe('2026-10-20T04:00:00.000Z');
    expect(r.posting.employmentRaw).toBe('Part-time');
    expect(r.india.isIndia).toBe(true);
    expect(r.company).toBe('Trellis Cloud');
  });

  it('non-India role (Country object name) is not India', () => {
    const r = parse('job-data-analyst-chicago.html', '/jobs/data-analyst-chicago');
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.india.isIndia).toBe(false);
    expect(r.posting.locationsRaw).toEqual(['Chicago, IL, US']);
    expect(r.posting.compensation?.min).toBe(90000);
    expect(r.posting.compensation?.max).toBe(90000);
    expect(r.posting.externalId).toBe('TC-3003');
  });

  it('expired postings are reported, not returned as open', () => {
    const r = parse('job-old-role-expired.html', '/jobs/old-role-expired');
    expect(r.kind).toBe('expired');
  });

  it('rejects missing title and non-https pages', () => {
    expect(parseJobPosting({ '@type': 'JobPosting' }, { pageUrl: `${B}/x`, host: 'h', now: NOW }).kind).toBe('missing_title');
    expect(parseJobPosting({ title: 'x' }, { pageUrl: 'http://a.b/x', host: 'h', now: NOW }).kind).toBe('bad_url');
  });

  it('salary only when baseSalary carries a real number; never infers from text', () => {
    const base = { title: 'T', description: 'Salary 10 LPA' };
    const o = { pageUrl: `${B}/j/1`, host: 'h', now: NOW };
    const c = (b: unknown) => { const r = parseJobPosting({ ...base, baseSalary: b }, o); return r.kind === 'ok' ? r.posting.compensation : 'rej'; };
    expect(c(undefined)).toBeNull();
    expect(c({ currency: 'INR', value: { value: 0, unitText: 'YEAR' } })).toBeNull();
    expect(c({ currency: 'INR', value: { unitText: 'YEAR' } })).toBeNull();
    expect(c({ currency: 'INR', value: 50000, })).toMatchObject({ min: 50000, max: 50000, interval: 'unknown' });
    expect(c({ currency: 'INR', value: { value: 30000, unitText: 'MONTH' } })).toMatchObject({ interval: 'month', currency: 'INR' });
    expect(c({ currency: 'INR', value: { minValue: 'abc' } })).toBeNull();
  });

  it('falls back to the URL path when there is no identifier', () => {
    const r = parseJobPosting({ title: 'T' }, { pageUrl: `${B}/jobs/x/`, host: 'h', now: NOW });
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.posting.externalId).toBe('/jobs/x');
  });

  it('long identifiers are hashed so the posting key stays under 255 chars', () => {
    const r = parseJobPosting({ title: 'T', identifier: 'x'.repeat(400) }, { pageUrl: `${B}/j/1`, host: 'h', now: NOW });
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(r.posting.externalId.length).toBeLessThan(100);
  });

  it('keeps only the JSON-LD object in raw', () => {
    const r = parse('job-graduate-engineer-bengaluru.html', '/jobs/graduate-engineer-bengaluru');
    if (r.kind !== 'ok') throw new Error(r.kind);
    expect(JSON.stringify(r.posting.raw)).not.toContain('secret page html');
  });
});

describe('detectIndia', () => {
  const loc = (city?: string, region?: string, country?: string) => ({ city, region, country });
  it('uses country codes and names', () => {
    expect(detectIndia([loc(undefined, undefined, 'IN')])).toEqual({ isIndia: true, reason: 'country' });
    expect(detectIndia([loc(undefined, undefined, 'IND')]).isIndia).toBe(true);
    expect(detectIndia([loc(undefined, undefined, 'India')]).isIndia).toBe(true);
    expect(detectIndia([loc(undefined, undefined, 'in')]).isIndia).toBe(true);
  });
  it('falls back to city then state when country is absent', () => {
    expect(detectIndia([loc('Bangalore')])).toEqual({ isIndia: true, reason: 'city' });
    expect(detectIndia([loc('Gurugram', 'HR')]).isIndia).toBe(true);
    expect(detectIndia([loc(undefined, 'Tamil Nadu')])).toEqual({ isIndia: true, reason: 'state' });
  });
  it('does not confuse Indiana (IN region) or other countries with India', () => {
    expect(detectIndia([loc('Indianapolis', 'IN', 'US')]).isIndia).toBe(false);
    expect(detectIndia([loc('Indianapolis', 'IN')]).isIndia).toBe(false);
    expect(detectIndia([loc('Mumbai', undefined, 'US')]).isIndia).toBe(false);
    expect(detectIndia([]).isIndia).toBe(false);
  });
});
