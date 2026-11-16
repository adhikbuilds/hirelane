import { describe, expect, it } from 'vitest';
import { answerFrom } from '../src/answers';
import { evaluateEligibility, parseCriteria } from '../src/eligibility';
import type { EligibilityProfileInput } from '../src/eligibility/types';
import { findUniversityRule } from '../src/eligibility/university';

const P = (o: Partial<EligibilityProfileInput> = {}): EligibilityProfileInput => ({ confirmed: true, grad_score: 6.5, grad_scale: 10, ...o });
const CAMPUS = { kind: 'linear', a: 10, b: 0 } as const; // 6.5 CGPA -> 65%
const vtu = findUniversityRule('vtu')!;
const mumbai = findUniversityRule('mumbai')!;
const rgpv = findUniversityRule('rgpv')!;
const run = (text: string, profile: EligibilityProfileInput, o: Parameters<typeof evaluateEligibility>[2]) => evaluateEligibility(parseCriteria(text), profile, o);

describe('a campus rule never overrides a scheme-keyed or disputed university row', () => {
  it('VTU, scheme unknown: no FAIL from the campus rule, the verdict is unknown', () => {
    const r = run('70% aggregate in graduation', P(), { cgpaRule: CAMPUS, universityRule: vtu, universityRuleConfirmed: true });
    expect(r.overall).toBe('unknown');
    expect(r.verdicts[0]!.reason).toContain('which VTU scheme');
  });
  it('VTU, scheme unknown: no PASS from the campus rule either', () => {
    expect(run('60% aggregate in graduation', P(), { cgpaRule: CAMPUS, universityRule: vtu }).overall).toBe('unknown');
  });
  it('Mumbai (disputed): the campus rule is ignored even when the student confirmed', () => {
    const r = run('70% aggregate in graduation', P(), { cgpaRule: CAMPUS, universityRule: mumbai, universityRuleConfirmed: true });
    expect(r.overall).toBe('unknown');
  });
  it('VTU with an explicit scheme follows the university variant, not the campus rule', () => {
    // 2018 scheme: (6.5 - 0.75) x 10 = 57.5%. The campus rule would say 65%.
    const r = run('60% aggregate in graduation', P(), { cgpaRule: CAMPUS, universityRule: vtu, universityRuleConfirmed: true, universityScheme: '2018' });
    expect(r.overall).toBe('fail');
    expect(r.verdicts[0]!.reason).toContain('57.5');
  });
  it('a university that is neither scheme-keyed nor disputed still takes the campus rule', () => {
    expect(run('60% aggregate in graduation', P(), { cgpaRule: CAMPUS, universityRule: rgpv }).overall).toBe('pass');
    expect(run('70% aggregate in graduation', P(), { cgpaRule: CAMPUS, universityRule: rgpv }).overall).toBe('fail');
  });
  it('no university row: the campus rule works as before', () => {
    expect(run('70% aggregate in graduation', P(), { cgpaRule: CAMPUS }).overall).toBe('fail');
  });
});

describe('VTU admission year alone never produces a FAIL', () => {
  const o = { cgpaRule: null, universityRule: vtu, universityRuleConfirmed: true } as const;
  it('year only, would fail: unknown and says the scheme is needed', () => {
    const r = run('60% aggregate in graduation', P(), { ...o, admissionYear: 2018 }); // 57.5% < 60
    expect(r.overall).toBe('unknown');
    expect(r.verdicts[0]!.reason).toMatch(/scheme/i);
  });
  it('year only, would pass: pass', () => {
    expect(run('55% aggregate in graduation', P(), { ...o, admissionYear: 2018 }).overall).toBe('pass');
  });
  it('explicit scheme, would fail: fail', () => {
    expect(run('60% aggregate in graduation', P(), { ...o, universityScheme: '2018', admissionYear: 2018 }).overall).toBe('fail');
  });
  it('a CGPA-cutoff criterion with a percentage student is also unknown on year only', () => {
    const r = run('Minimum 7.0 CGPA in graduation', P({ grad_score: 60, grad_scale: 100 }), { ...o, admissionYear: 2018 });
    expect(r.overall).not.toBe('fail');
  });
});

describe('the applied percentage is never computed from an ambiguous rule', () => {
  const profile = { eligibility: { confirmed: true, grad_score: 6.5, grad_scale: 10 } } as never;
  const set = (opts: object) => answerFrom(profile, [], undefined, { name: 'Acme', about: '' }, opts).percentage;
  it('VTU without a scheme stays needs_you even with a campus rule', () => {
    expect(set({ campusRule: CAMPUS, universityRule: vtu, universityRuleConfirmed: true }).status).toBe('needs_you');
  });
  it('Mumbai (disputed) stays needs_you with a campus rule', () => {
    expect(set({ campusRule: CAMPUS, universityRule: mumbai, universityRuleConfirmed: true }).status).toBe('needs_you');
  });
  it('an explicit VTU scheme on a confirmed row still fills', () => {
    expect(set({ universityRule: vtu, universityRuleConfirmed: true, universityScheme: '2022' }).status).toBe('filled');
  });
});

describe('the scheme and admission year stored on the profile are used when the caller passes none', () => {
  const o = { cgpaRule: CAMPUS, universityRule: vtu, universityRuleConfirmed: true } as const;
  it('a stored scheme picks the variant (2018: 6.5 CGPA = 57.5%)', () => {
    const r = run('60% aggregate in graduation', P({ university_scheme: '2018' }), o);
    expect(r.overall).toBe('fail');
    expect(r.verdicts[0]!.reason).toContain('57.5');
  });
  it('a stored admission year alone can pass but never fail', () => {
    expect(run('55% aggregate in graduation', P({ admission_year: 2018 }), o).overall).toBe('pass');
    expect(run('60% aggregate in graduation', P({ admission_year: 2018 }), o).overall).toBe('unknown');
  });
  it('an explicit option wins over the profile', () => {
    expect(run('60% aggregate in graduation', P({ university_scheme: '2018' }), { ...o, universityScheme: '2022' }).overall).toBe('pass'); // 65%
  });
});

describe('a flagged-unverified campus rule is never used for a percentage answer', () => {
  const profile = { eligibility: { confirmed: true, grad_score: 6.5, grad_scale: 10 } } as never;
  it('answerFrom leaves it for needs-you', () => {
    const a = answerFrom(profile, [], undefined, { name: 'Acme', about: '' }, { campusRule: { ...CAMPUS, unverified: true } });
    expect(a.percentage.status).toBe('needs_you');
    expect(answerFrom(profile, [], undefined, { name: 'Acme', about: '' }, { campusRule: CAMPUS }).percentage.status).toBe('filled');
  });
});
