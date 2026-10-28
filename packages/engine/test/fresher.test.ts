import { describe, expect, it } from 'vitest';
import { assessFresher, type FresherInput } from '../src/fresher';

const req = (text: string, yearsMin: number | null, kind: 'must' | 'nice' = 'must') => ({ kind, text, yearsMin, spanStart: 10, spanEnd: 10 + text.length });
const mk = (over: Partial<FresherInput> = {}): FresherInput => ({ title: 'Software Engineer', level: null, requirements: [], text: '', ...over });

describe('assessFresher: golden positives', () => {
  const cases: [string, Partial<FresherInput>][] = [
    ['intern title', { title: 'Software Engineering Intern', level: 'intern' }],
    ['internship title', { title: 'Marketing Internship (Summer 2027)' }],
    ['new grad title', { title: 'Software Engineer, New Grad', level: 'entry' }],
    ['new graduate', { title: 'New Graduate Software Engineer' }],
    ['graduate title', { title: 'Graduate Analyst' }],
    ['entry-level title', { title: 'Entry-Level Data Analyst' }],
    ['entry level classifier, no years', { title: 'Analyst I', level: 'entry' }],
    ['0-1 years requirement', { requirements: [req('0-1 years of experience in Python', 0)] }],
    ['0-2 years requirement', { requirements: [req('0-2 years of professional experience', 0)] }],
    ['0 to 2 years in text', { text: 'We want 0 to 2 years of experience with APIs.' }],
    ['freshers in text', { text: 'Freshers can apply. Great training program.' }],
    ['campus hiring', { text: 'This role is part of our campus hiring drive.' }],
    ['batch of 2026', { text: 'Open to the batch of 2026.' }],
    ['batch of 2025', { text: 'Candidates from the 2025 batch... Batch of 2025 only.' }],
    ['recent graduates', { text: 'Recent graduates are encouraged to apply.' }],
    ['no experience required', { text: 'No prior experience required.' }],
    ['1 year requirement', { requirements: [req('1 year of experience', 1)] }],
  ];
  for (const [name, over] of cases) {
    it(name, () => {
      const r = assessFresher(mk(over));
      expect(r.fresher, r.reason).toBe(true);
      expect(r.evidence.length).toBeGreaterThan(0);
      expect(r.reason).not.toBe('');
    });
  }
});

describe('assessFresher: golden negatives', () => {
  const cases: [string, Partial<FresherInput>][] = [
    ['senior title', { title: 'Senior Software Engineer', level: 'senior' }],
    ['staff title', { title: 'Staff Engineer' }],
    ['lead title', { title: 'Tech Lead', level: 'lead' }],
    ['manager title', { title: 'Engineering Manager' }],
    ['principal', { title: 'Principal Designer' }],
    ['3+ years', { requirements: [req('3+ years of experience', 3)] }],
    ['5 years in text', { text: 'You have 5+ years of experience building services.' }],
    ['plain engineer, no signal', {}],
    ['associate with 4 years', { title: 'Associate Legal', level: 'entry', requirements: [req('4+ years of experience in contracts', 4)] }],
    ['entry classifier with 2 years', { level: 'entry', requirements: [req('2+ years of experience', 2)] }],
    ['campus as office location only', { text: 'Join us at our Mountain View campus. Free lunch.' }],
    ['graduate degree is not fresher', { text: 'A graduate degree in CS is preferred.' }],
    ['senior but says new grads mentored', { title: 'Senior Engineer', text: 'You will mentor new grads.' }],
    ['nice-to-have low years does not block', { title: 'Staff Engineer', requirements: [req('0-1 years of Rust', 0, 'nice')] }],
  ];
  for (const [name, over] of cases) {
    it(name, () => {
      const r = assessFresher(mk(over));
      expect(r.fresher, r.reason).toBe(false);
      expect(r.reason).not.toBe('');
    });
  }
});

describe('assessFresher: precedence', () => {
  it('explicit new-grad title with 3+ years still false (years win)', () => {
    expect(assessFresher(mk({ title: 'New Grad Engineer', requirements: [req('3+ years of experience', 3)] })).fresher).toBe(false);
  });
  it('a 2-year must requirement alone is not fresher but a 0-2 range is', () => {
    expect(assessFresher(mk({ requirements: [req('2+ years of experience', 2)] })).fresher).toBe(false);
    expect(assessFresher(mk({ requirements: [req('0-2 years of experience', 0)] })).fresher).toBe(true);
  });
  it('1-3 years is not fresher', () => {
    expect(assessFresher(mk({ requirements: [req('1-3 years of experience', 1)] })).fresher).toBe(false);
  });
  it('evidence points at the title for title signals', () => {
    const r = assessFresher(mk({ title: 'Software Engineer, New Grad' }));
    expect(r.evidence[0]).toMatchObject({ source: 'title', quote: 'New Grad' });
  });
});

describe('assessFresher: properties', () => {
  it('is deterministic and does not mutate input', () => {
    const input = mk({ title: 'Graduate Analyst', requirements: [req('0-2 years of experience', 0)], text: 'Freshers welcome.' });
    const snap = JSON.stringify(input);
    expect(assessFresher(input)).toEqual(assessFresher(input));
    expect(JSON.stringify(input)).toBe(snap);
  });
  it('any seniority word in the title forces false when no fresher words are present', () => {
    for (const w of ['Senior', 'Sr.', 'Lead', 'Staff', 'Principal', 'Manager', 'Head of', 'Director', 'VP']) {
      for (const role of ['Engineer', 'Designer', 'Analyst']) {
        const title = w === 'Manager' ? `${role} Manager` : `${w} ${role}`;
        expect(assessFresher(mk({ title })).fresher, title).toBe(false);
      }
    }
  });
  it('any must requirement of N >= 3 years forces false, regardless of title', () => {
    for (let n = 3; n <= 30; n++) {
      for (const title of ['Software Engineer', 'Intern', 'New Grad Engineer', 'Graduate Analyst']) {
        expect(assessFresher(mk({ title, requirements: [req(`${n}+ years of experience`, n)] })).fresher, `${title} ${n}`).toBe(false);
      }
    }
  });
  it('N in {0,1} years with a neutral title is fresher', () => {
    for (const n of [0, 1]) expect(assessFresher(mk({ requirements: [req(`${n}+ years of experience`, n)] })).fresher).toBe(true);
  });
  it('output shape is stable across a title/level grid', () => {
    for (const title of ['', 'x', 'Intern', 'Senior Intern', '  ', 'Ünïcödé 工程师 🚀']) {
      for (const level of [null, 'intern', 'entry', 'mid', 'senior', 'lead', 'executive'] as const) {
        const r = assessFresher(mk({ title, level }));
        expect(typeof r.fresher).toBe('boolean');
        expect(typeof r.reason).toBe('string');
        expect(Array.isArray(r.evidence)).toBe(true);
      }
    }
  });
  it('tolerates missing optional fields', () => {
    expect(assessFresher({ title: 'Intern', level: null }).fresher).toBe(true);
  });
});
