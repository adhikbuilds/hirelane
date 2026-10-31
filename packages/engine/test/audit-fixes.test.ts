import { describe, expect, it } from 'vitest';
import { answerFrom, classifyQuestion } from '../src/answers';
import { evaluateEligibility, parseCriteria } from '../src/eligibility';
import { findUniversityRule } from '../src/eligibility/university';
import type { EligibilityProfileInput } from '../src/eligibility/types';

const P = (o: Partial<EligibilityProfileInput> = {}): EligibilityProfileInput => ({ confirmed: true, ...o });

describe('university lookup', () => {
  it('never applies a school-board row to a graduation CGPA', () => {
    expect(findUniversityRule('cbse')).toBeNull();
    expect(findUniversityRule('Central Board of Secondary Education')).toBeNull();
    expect(findUniversityRule('ABC Public School, CBSE')).toBeNull();
  });
  it('a generic alias without its place does not resolve to one state\'s university', () => {
    expect(findUniversityRule('Mahatma Gandhi University')).toBeNull();
    expect(findUniversityRule('Mahatma Gandhi University, Nalgonda')).toBeNull();
    expect(findUniversityRule('Mahatma Gandhi University, Meghalaya')).toBeNull();
    // The full name and the specific aliases still work.
    expect(findUniversityRule('Mahatma Gandhi University, Kerala')?.id).toBe('mgu');
    expect(findUniversityRule('MG University')?.id).toBe('mgu');
  });
  it('known universities still resolve by id, name and inside a longer line', () => {
    expect(findUniversityRule('rgpv')?.id).toBe('rgpv');
    expect(findUniversityRule('ABC Institute, affiliated to VTU')?.id).toBe('vtu');
  });
});

describe('cutoffs are compared before rounding', () => {
  const rule = { kind: 'linear' as const, a: 10, b: 0 };
  const run = (cgpa: number, text: string) => evaluateEligibility(parseCriteria(text), P({ grad_score: cgpa, grad_scale: 10, passout_year: 2026 }), { cgpaRule: rule });
  it('59.95% does not pass a 60% cutoff', () => {
    const r = run(5.995, 'Minimum 60% in graduation.');
    const g = r.verdicts.find((v) => v.status !== 'pass' || true)!;
    expect(r.overall).toBe('fail');
    expect(g.reason).not.toMatch(/Short by 0(\.0)?%/);
  });
  it('60.0 exactly and 59.96 handled either side of the line', () => {
    expect(run(6.0, 'Minimum 60% in graduation.').overall).toBe('pass');
    expect(run(5.996, 'Minimum 60% in graduation.').overall).toBe('fail');
    expect(run(6.01, 'Minimum 60% in graduation.').overall).toBe('pass');
  });
});

describe('the submitted percentage equals the percentage used for eligibility', () => {
  const profile = { fullName: 'Asha Rao', email: 'a@example.test', workAuthorizations: [] };
  const company = { name: 'Acme', about: '', role: 'Engineer' };
  const resume = { confirmed: true, skills: [], projects: [], experience: [], links: [] };
  it('prefers the university-printed percentage ("direct") over a rule conversion, as evaluate does', () => {
    const elig = { confirmed: true, grad_score: 8.0, grad_scale: 10, grad_conversion: 'direct', grad_pct_equiv: 71.2 } as never;
    const s = answerFrom({ ...profile, eligibility: elig }, [], resume, company, { campusRule: { kind: 'linear', a: 10, b: 0 } });
    expect(s.percentage.value).toBe('71.2%');
    expect(s.percentage.evidence[0]!.field).toBe('grad_pct_equiv');
    const v = evaluateEligibility(parseCriteria('Minimum 72% in graduation.'), elig, { cgpaRule: { kind: 'linear', a: 10, b: 0 } });
    expect(v.overall).toBe('fail'); // eligibility used 71.2, not 80
  });
});

describe('labels', () => {
  const k = (l: string) => classifyQuestion(l).key;
  it('a percentage that is not about academics is not the graduation percentage', () => {
    expect(k('What percentage of travel are you comfortable with?')).toBe('unknown');
    expect(k('What percentage of your time do you spend on code review?')).toBe('unknown');
    expect(k('Percentage of marks scored in graduation')).toBe('percentage');
    expect(k('Aggregate percentage (UG)')).toBe('percentage');
    expect(k('Degree CGPA / percentage')).toBe('cgpa_pct');
    expect(k('Graduation marks (%)')).toBe('percentage');
  });
});
