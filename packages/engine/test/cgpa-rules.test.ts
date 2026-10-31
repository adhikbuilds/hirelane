import { describe, expect, it } from 'vitest';
import rulesJson from '../data/cgpa-rules.json';
import { applyCgpaRule } from '../src/eligibility/cgpa';
import { findUniversityRule, toCgpaRule, universityRules } from '../src/eligibility/university';

describe('cgpa-rules.json', () => {
  const rows = universityRules();
  it('has at least 25 universities, ids unique, none assumed from another university', () => {
    expect(rows.length).toBeGreaterThanOrEqual(25);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) expect(r.note, r.id).not.toMatch(/assumed to follow/i);
  });
  it('names the universities the PRD asks for', () => {
    for (const id of ['aktu', 'rgpv', 'vtu', 'mumbai', 'sppu', 'anna', 'jntuh', 'gtu', 'makaut', 'cbse']) expect(rows.some((r) => r.id === id), id).toBe(true);
  });
  it('every row carries formula, source_url, checked_on and a boolean verified', () => {
    for (const r of rows) {
      expect(r.formula.length, r.id).toBeGreaterThan(5);
      expect(r.source_url, r.id).toMatch(/^https:\/\//);
      expect(r.checked_on, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof r.verified, r.id).toBe('boolean');
      expect(r.check_method.length, r.id).toBeGreaterThan(0);
    }
  });
  it('every row converts its own example (conversion test per row)', () => {
    for (const r of rows) {
      expect(applyCgpaRule(r.example.cgpa, toCgpaRule(r)), r.id).toBeCloseTo(r.example.pct, 2);
    }
  });
  it('the printed formula matches a and b', () => {
    for (const r of rows) {
      const nums = [...r.formula.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]));
      if (r.b === 0) expect(nums, r.id).toContain(r.a);
      else if (r.a === 10 && r.b < 0) expect(nums, r.id).toContain(-r.b / 10);
      else expect(nums, r.id).toEqual(expect.arrayContaining([r.a, r.b]));
    }
  });
  it('no row is marked verified without a fetched check', () => {
    for (const r of rows) if (r.verified) expect(r.check_method, r.id).toMatch(/^fetched/);
  });
  it('the file has not drifted from the typed view', () => {
    expect(rows.length).toBe((rulesJson as { rules: unknown[] }).rules.length);
  });
});

describe('findUniversityRule', () => {
  it('matches id, name and alias, ignoring case, dots and punctuation', () => {
    expect(findUniversityRule('RGPV')?.id).toBe('rgpv');
    expect(findUniversityRule('  Visvesvaraya Technological University ')?.id).toBe('vtu');
    expect(findUniversityRule('Dr. A.P.J. Abdul Kalam Technical University')?.id).toBe('aktu');
    expect(findUniversityRule('Mumbai University')?.id).toBe('mumbai');
    expect(findUniversityRule('jntu-hyderabad')?.id).toBe('jntuh');
  });
  it('finds a rule inside a longer college line', () => {
    expect(findUniversityRule('ABC Institute of Technology, affiliated to VTU, Belagavi')?.id).toBe('vtu');
  });
  it('a place name inside a longer line is not a university', () => {
    expect(findUniversityRule('Nirma University, Ahmedabad, Gujarat')).toBeNull();
    expect(findUniversityRule('XYZ Deemed University, Mumbai')).toBeNull();
    expect(findUniversityRule('Some College, Pondicherry')).toBeNull();
  });
  it('returns null for nothing, unknown names and non-strings', () => {
    for (const q of ['', '   ', 'Hogwarts University', null, undefined, 7 as unknown as string]) expect(findUniversityRule(q as string)).toBeNull();
  });
  it('short aliases need an exact match, so "mu" does not hit inside words', () => {
    expect(findUniversityRule('community college')).toBeNull();
    expect(findUniversityRule('MU')?.id).toBe('mumbai');
  });
});

describe('toCgpaRule', () => {
  it('returns the linear campus-style rule', () => {
    expect(toCgpaRule(findUniversityRule('vtu')!)).toEqual({ kind: 'linear', a: 10, b: -7.5 });
  });
});
