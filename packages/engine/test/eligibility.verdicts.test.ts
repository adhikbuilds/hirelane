import { describe, expect, it } from 'vitest';
import { evaluateEligibility, parseCriteria } from '../src/eligibility';
import type { EligibilityProfileInput } from '../src/eligibility/types';
import { findUniversityRule } from '../src/eligibility/university';

const P = (o: Partial<EligibilityProfileInput> = {}): EligibilityProfileInput => ({ confirmed: true, ...o });
const rgpv = findUniversityRule('rgpv')!;

describe('readable reasons with the maths', () => {
  it('a short 12th names the gap', () => {
    const r = evaluateEligibility(parseCriteria('Minimum 60% in 12th'), P({ secondary_kind: '12th', pct_secondary: 58 }), { cgpaRule: null });
    expect(r.verdicts[0]!.status).toBe('fail');
    expect(r.verdicts[0]!.reason).toBe('Your 12th: 58%. Needs 60%. Short by 2%');
  });
  it('a met 12th says so', () => {
    const r = evaluateEligibility(parseCriteria('Minimum 60% in 12th'), P({ secondary_kind: '12th', pct_secondary: 75 }), { cgpaRule: null });
    expect(r.verdicts[0]!.reason).toBe('Your 12th: 75%. Needs 60%: you meet it');
  });
  it('10th and diploma use their own names', () => {
    expect(evaluateEligibility(parseCriteria('Minimum 60% in 10th'), P({ pct_10: 55.5 }), { cgpaRule: null }).verdicts[0]!.reason).toBe('Your 10th: 55.5%. Needs 60%. Short by 4.5%');
    expect(evaluateEligibility(parseCriteria('Minimum 60% in 12th/Diploma'), P({ secondary_kind: 'diploma', pct_secondary: 70 }), { cgpaRule: null }).verdicts[0]!.reason).toBe('Your diploma: 70%. Needs 60%: you meet it');
  });
  it('shows the CGPA conversion with a university rule the student confirmed', () => {
    const r = evaluateEligibility(parseCriteria('60% aggregate in graduation'), P({ grad_score: 8.1, grad_scale: 10 }), { cgpaRule: null, universityRule: rgpv, universityRuleConfirmed: true });
    expect(r.verdicts[0]!.status).toBe('pass');
    expect(r.verdicts[0]!.reason).toBe("8.1 CGPA = 77.0% by RGPV's rule, needs 60%: you meet it");
  });
  it('shows a failing conversion with the gap', () => {
    const r = evaluateEligibility(parseCriteria('70% aggregate in graduation'), P({ grad_score: 7, grad_scale: 10 }), { cgpaRule: null, universityRule: rgpv, universityRuleConfirmed: true });
    expect(r.verdicts[0]!.status).toBe('fail');
    expect(r.verdicts[0]!.reason).toBe("7.0 CGPA = 66.5% by RGPV's rule, needs 70%. Short by 3.5%");
  });
  it('names the campus rule when it supplies the conversion', () => {
    const r = evaluateEligibility(parseCriteria('60% aggregate in graduation'), P({ grad_score: 8, grad_scale: 10 }), { cgpaRule: { kind: 'linear', a: 9.5, b: 0 } });
    expect(r.verdicts[0]!.reason).toBe("8.0 CGPA = 76.0% by your campus's rule, needs 60%: you meet it");
  });
  it('rounds the comparison the same way it prints: never "60.0%, short by 0.0%"', () => {
    // 6.3158 x 9.5 = 59.9999 prints as 60.0 and meets 60
    const r = evaluateEligibility(parseCriteria('60% aggregate in graduation'), P({ grad_score: 6.3158, grad_scale: 10 }), { cgpaRule: { kind: 'linear', a: 9.5, b: 0 } });
    expect(r.verdicts[0]!.status).toBe('pass');
    expect(r.verdicts[0]!.reason).not.toMatch(/Short by 0/);
    const f = evaluateEligibility(parseCriteria('60% aggregate in graduation'), P({ grad_score: 6.3, grad_scale: 10 }), { cgpaRule: { kind: 'linear', a: 9.5, b: 0 } });
    expect(f.verdicts[0]!.status).toBe('fail');
    expect(f.verdicts[0]!.reason).toBe("6.3 CGPA = 59.9% by your campus's rule, needs 60%. Short by 0.1%");
  });
  it('a same-scale CGPA criterion shows plain numbers', () => {
    const r = evaluateEligibility(parseCriteria('Minimum 6.5 CGPA in graduation'), P({ grad_score: 6.2, grad_scale: 10 }), { cgpaRule: null });
    expect(r.verdicts[0]!.reason).toBe('Your graduation CGPA: 6.2. Needs 6.5. Short by 0.3');
  });
});

describe('rule precedence and honesty', () => {
  const crit = parseCriteria('60% aggregate in graduation');
  const prof = P({ grad_score: 8.1, grad_scale: 10 });
  it('no rule at all: unknown, and says which rule is missing', () => {
    const r = evaluateEligibility(crit, prof, { cgpaRule: null });
    expect(r.verdicts[0]!.status).toBe('unknown');
    expect(r.verdicts[0]!.reason).toMatch(/rule/i);
    expect(r.verdicts[0]!.reason).toMatch(/8\.1/);
  });
  it('an unverified university rule is not used until confirmed', () => {
    expect(rgpv.verified).toBe(false);
    const r = evaluateEligibility(crit, prof, { cgpaRule: null, universityRule: rgpv });
    expect(r.verdicts[0]!.status).toBe('unknown');
    expect(r.verdicts[0]!.reason).toContain('RGPV');
    expect(r.verdicts[0]!.reason).toMatch(/confirm/i);
  });
  it('a verified university rule is used without confirmation', () => {
    const r = evaluateEligibility(crit, prof, { cgpaRule: null, universityRule: { ...rgpv, verified: true } });
    expect(r.verdicts[0]!.status).toBe('pass');
  });
  it('the campus rule overrides the university rule, confirmed or not', () => {
    const r = evaluateEligibility(parseCriteria('76% aggregate in graduation'), P({ grad_score: 8, grad_scale: 10 }), { cgpaRule: { kind: 'linear', a: 10, b: 0 }, universityRule: rgpv, universityRuleConfirmed: true });
    expect(r.verdicts[0]!.reason).toContain("campus's rule");
    expect(r.verdicts[0]!.status).toBe('pass'); // 80 by campus; 76 by RGPV would also pass
    const r2 = evaluateEligibility(parseCriteria('78% aggregate in graduation'), P({ grad_score: 8, grad_scale: 10 }), { cgpaRule: { kind: 'linear', a: 9, b: 0 }, universityRule: { ...rgpv, a: 10 }, universityRuleConfirmed: true });
    expect(r2.verdicts[0]!.status).toBe('fail'); // campus 72 < 78 even though the university rule gives 80
  });
  it('an unconfirmed rule never turns unknown into fail', () => {
    const r = evaluateEligibility(parseCriteria('95% aggregate in graduation'), prof, { cgpaRule: null, universityRule: rgpv });
    expect(r.verdicts[0]!.status).toBe('unknown');
  });
  it('a 4-point CGPA is not run through a 10-point rule', () => {
    const r = evaluateEligibility(crit, P({ grad_score: 3.4, grad_scale: 4 }), { cgpaRule: null, universityRule: rgpv, universityRuleConfirmed: true });
    expect(r.verdicts[0]!.status).toBe('unknown');
  });
  it('a CGPA criterion with a stated percentage uses the inverse of the confirmed rule', () => {
    const r = evaluateEligibility(parseCriteria('Minimum 7.5 CGPA in graduation'), P({ grad_score: 80, grad_scale: 100 }), { cgpaRule: null, universityRule: { ...rgpv, a: 10 }, universityRuleConfirmed: true });
    expect(r.verdicts[0]!.status).toBe('pass');
    expect(r.verdicts[0]!.reason).toMatch(/CGPA/);
  });
});

describe('one verdict per level for "throughout" rules', () => {
  const crit = parseCriteria('60% throughout in 10th, 12th and graduation');
  it('lists each level with its own status and reason', () => {
    const r = evaluateEligibility(crit, P({ pct_10: 80, secondary_kind: '12th', pct_secondary: 58, grad_score: 8.1, grad_scale: 10 }), { cgpaRule: null, universityRule: rgpv, universityRuleConfirmed: true });
    const v = r.verdicts[0]!;
    expect(v.levels?.map((l) => [l.level, l.status])).toEqual([
      ['10th', 'pass'],
      ['12th', 'fail'],
      ['graduation', 'pass'],
    ]);
    expect(v.levels![0]!.reason).toBe('Your 10th: 80%. Needs 60%: you meet it');
    expect(v.levels![1]!.reason).toBe('Your 12th: 58%. Needs 60%. Short by 2%');
    expect(v.levels![2]!.reason).toBe("8.1 CGPA = 77.0% by RGPV's rule, needs 60%: you meet it");
    expect(v.status).toBe('fail');
    expect(v.reason).toBe('Your 12th: 58%. Needs 60%. Short by 2%');
  });
  it('passing at every level says so', () => {
    const r = evaluateEligibility(crit, P({ pct_10: 80, secondary_kind: '12th', pct_secondary: 70, grad_score: 70, grad_scale: 100 }), { cgpaRule: null });
    expect(r.verdicts[0]!.status).toBe('pass');
    expect(r.verdicts[0]!.reason).toBe('You meet 60% at every level: 10th, 12th, graduation');
  });
  it('an unknown level does not hide a fail at another', () => {
    const r = evaluateEligibility(crit, P({ pct_10: 40 }), { cgpaRule: null });
    expect(r.verdicts[0]!.status).toBe('fail');
    expect(r.verdicts[0]!.levels!.map((l) => l.status)).toEqual(['fail', 'unknown', 'unknown']);
  });
  it('a single-level criterion carries one level entry', () => {
    const r = evaluateEligibility(parseCriteria('Minimum 60% in 12th'), P({ secondary_kind: '12th', pct_secondary: 70 }), { cgpaRule: null });
    expect(r.verdicts[0]!.levels).toHaveLength(1);
  });
  it('non-score criteria have no levels and a plain reason', () => {
    const r = evaluateEligibility(parseCriteria('No active backlogs'), P({ active_backlogs: 2 }), { cgpaRule: null });
    expect(r.verdicts[0]!.levels).toBeUndefined();
    expect(r.verdicts[0]!.reason).toBe('You have 2 active backlogs. This drive needs none');
  });
});

describe('paste-a-job passes the university rule through', async () => {
  const { parsePastedJob, scoreForProfile } = await import('../src/jobtext');
  it('shows the maths on the job verdict', () => {
    const job = parsePastedJob('Hiring freshers 2026 batch. Minimum 60% aggregate in graduation.');
    const s = scoreForProfile(job, { skillIds: [], cities: [], remote: false }, P({ grad_score: 8.1, grad_scale: 10 }), { now: '2026-10-29T00:00:00Z', universityRule: rgpv, universityRuleConfirmed: true });
    expect(s.eligibility.verdicts.some((v) => v.reason === "8.1 CGPA = 77.0% by RGPV's rule, needs 60%: you meet it")).toBe(true);
  });
});
