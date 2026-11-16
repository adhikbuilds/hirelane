import { describe, expect, it } from 'vitest';
import { evaluateEligibility, parseCriteria } from '../src/eligibility';
import { applyCgpaRule } from '../src/eligibility/cgpa';
import type { EligibilityProfileInput } from '../src/eligibility/types';

const P = (o: Partial<EligibilityProfileInput> = {}): EligibilityProfileInput => ({ confirmed: true, ...o });
const run = (text: string, profile: EligibilityProfileInput | null | undefined, rule: { kind: 'linear'; a: number; b: number } | null = null) =>
  evaluateEligibility(parseCriteria(text), profile, { cgpaRule: rule });

describe('overall roll-up', () => {
  it('empty criteria with a confirmed profile is pass', () => {
    expect(evaluateEligibility([], P(), { cgpaRule: null })).toEqual({ overall: 'pass', verdicts: [] });
  });
  it('fail beats unknown; unknown beats pass', () => {
    expect(run('No active backlogs. 2026 batch only.', P({ active_backlogs: 2 })).overall).toBe('fail');
    expect(run('No active backlogs. 2026 batch only.', P({ active_backlogs: 0 })).overall).toBe('unknown');
    expect(run('No active backlogs. 2026 batch only.', P({ active_backlogs: 0, passout_year: 2026 })).overall).toBe('pass');
  });
});

describe('only confirmed profiles count', () => {
  it('unconfirmed, null and undefined profiles are all unknown, never fail', () => {
    const bad = { active_backlogs: 9, confirmed: false } as unknown as EligibilityProfileInput;
    for (const p of [bad, null, undefined]) {
      const r = run('No active backlogs', p);
      expect(r.overall).toBe('unknown');
      expect(r.verdicts.every((v) => v.status === 'unknown')).toBe(true);
    }
  });
});

describe('CGPA versus percent', () => {
  it('is unknown without a rule and decided with one', () => {
    const p = P({ grad_score: 8, grad_scale: 10 });
    expect(run('65% aggregate in graduation', p, null).overall).toBe('unknown');
    expect(run('65% aggregate in graduation', p, { kind: 'linear', a: 9.5, b: 0 }).overall).toBe('pass');
    expect(run('65% aggregate in graduation', P({ grad_score: 6, grad_scale: 10 }), { kind: 'linear', a: 9.5, b: 0 }).overall).toBe('fail');
  });
  it('a CGPA-only criterion compares same-scale CGPA directly with no rule', () => {
    expect(run('Minimum 6.5 CGPA in graduation', P({ grad_score: 7, grad_scale: 10 })).overall).toBe('pass');
  });
  it('a failing final grade is only unknown while the degree is not final', () => {
    const rule = { kind: 'linear', a: 9.5, b: 0 } as const;
    expect(run('65% aggregate in graduation', P({ grad_score: 6, grad_scale: 10, grad_is_final: false }), rule).overall).toBe('unknown');
  });
  it('applyCgpaRule: linear, null rule, non-finite and out-of-range', () => {
    expect(applyCgpaRule(8, { kind: 'linear', a: 9.5, b: 0 })).toBeCloseTo(76);
    expect(applyCgpaRule(8, null)).toBeNull();
    expect(applyCgpaRule(Number.NaN, { kind: 'linear', a: 1, b: 0 })).toBeNull();
    expect(applyCgpaRule(8, { kind: 'linear', a: Number.NaN, b: 0 })).toBeNull();
    expect(applyCgpaRule(10, { kind: 'linear', a: 20, b: 0 })).toBe(100);
  });
  it('CGPA-only criterion JSON round-trips (NaN becomes null) and still evaluates', () => {
    const cs = JSON.parse(JSON.stringify(parseCriteria('Minimum 6.5 CGPA in graduation')));
    const r = evaluateEligibility(cs, P({ grad_score: 7, grad_scale: 10 }), { cgpaRule: null });
    expect(r.overall).toBe('pass');
  });
});

describe('diploma', () => {
  const dip = P({ secondary_kind: 'diploma', pct_secondary: 80 });
  it('never passes or fails against a 12th-only notice', () => {
    expect(run('Minimum 60% in 12th', dip).overall).toBe('unknown');
    expect(run('Minimum 60% in 12th', P({ secondary_kind: 'diploma', pct_secondary: 10 })).overall).toBe('unknown');
  });
  it('is compared when the notice says 12th/Diploma', () => {
    expect(run('Minimum 60% in 12th/Diploma', dip).overall).toBe('pass');
    expect(run('Minimum 60% in 12th/Diploma', P({ secondary_kind: 'diploma', pct_secondary: 10 })).overall).toBe('fail');
  });
});

describe('missing and invalid input', () => {
  it('every criterion is unknown on an empty confirmed profile', () => {
    const r = run('60% throughout. No active backlogs. 2026 batch only. Gap up to 1 year. B.Tech only. CSE/IT only.', P());
    expect(r.verdicts.length).toBeGreaterThanOrEqual(6);
    expect(r.verdicts.every((v) => v.status === 'unknown')).toBe(true);
    expect(r.overall).toBe('unknown');
  });
  it('NaN, null, negative and out-of-range numbers are unknown', () => {
    for (const bad of [Number.NaN, null as unknown as number, -3, 140]) {
      expect(run('Minimum 60% in 10th', P({ pct_10: bad })).overall).toBe('unknown');
    }
    expect(run('No active backlogs', P({ active_backlogs: -1 })).overall).toBe('unknown');
  });
  it('boundary: exactly the minimum passes', () => {
    expect(run('Minimum 60% in 10th', P({ pct_10: 60 })).overall).toBe('pass');
    expect(run('Minimum 60% in 10th', P({ pct_10: 59.99 })).overall).toBe('fail');
  });
  it('verdicts carry a reason and the criterion', () => {
    const r = run('No active backlogs', P({ active_backlogs: 2 }));
    expect(r.verdicts[0]!.reason.length).toBeGreaterThan(0);
    expect(r.verdicts[0]!.criterion.type).toBe('no_active_backlogs');
    expect(r.verdicts[0]!.profileField).toBe('active_backlogs');
  });
});

describe('branches and degrees', () => {
  it('related branches (AI/ML under CS) are unknown, not fail', () => {
    expect(run('CSE/IT only', P({ branch_code: 'AIML' })).overall).toBe('unknown');
    expect(run('CSE/IT only', P({ branch_code: 'MECH' })).overall).toBe('fail');
  });
  it('degree aliases normalise', () => {
    for (const d of ['B.Tech', 'btech', 'B.E.', 'Bachelor of Technology']) expect(run('B.E/B.Tech', P({ degree: d })).overall).toBe('pass');
  });
});
