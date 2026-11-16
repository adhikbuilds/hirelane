import { describe, expect, it } from 'vitest';
import { eligibilityFromRow } from '../src/tasks/apply-common';
import { answerPortFor } from '../src/tasks/apply-submit';

// The percentage an employer receives is never computed from an unverified or ambiguous rule: the field is left for the
// student (needs-you). Pure; synthetic data; no database, no network, no model.
const claimed = { id: 'a1', userId: 'u1', platform: 'greenhouse' as const, applyUrl: 'https://greenhouse.fixture.invalid/x', resumeId: null, jobId: null, companyName: 'Acme', jobTitle: 'Engineer', attemptsToday: 1, dailyCap: 20 };
const CAMPUS = { kind: 'linear', a: 10, b: 0 }; // 7.8 CGPA -> 78%
const facts = (over: Record<string, unknown> = {}) =>
  ({
    fullName: 'Asha Kulkarni',
    applyAddress: 'asha@apply.example.test',
    autoApply: true,
    eligibility: { confirmed: true, grad_score: 7.8, grad_scale: 10, grad_conversion: 'unknown' },
    workAuthorizations: [],
    bank: [],
    campusRule: CAMPUS,
    campusName: 'Bengaluru Test College',
    countries: ['IN'],
    resumeConfirmed: true,
    skills: [],
    sensitiveKinds: [],
    ...over,
  }) as never;
const ask = (f: unknown) => answerPortFor(f as never, claimed).resolve({ label: 'What is your graduation percentage?', kind: 'text' });

describe('percentage answer', () => {
  it('a campus whose university is not scheme-keyed or disputed fills from the campus rule, with evidence', async () => {
    const r = await ask(facts());
    expect(r).toMatchObject({ status: 'filled', value: '78.0%' });
    expect(r.evidence.length).toBeGreaterThan(0);
  });
  it.each([['Test College affiliated to VTU'], ['Test College, University of Mumbai']])('%s: the campus rule is ignored and the field is left for the student', async (campusName) => {
    const r = await ask(facts({ campusName }));
    expect(r.status).toBe('needs_you');
    expect(r.value).toBeNull();
  });
  it('even with a stored scheme, VTU is not computed: the rule is unverified', async () => {
    const r = await ask(facts({ campusName: 'Test College affiliated to VTU', eligibility: { confirmed: true, grad_score: 7.8, grad_scale: 10, university_scheme: '2022' } }));
    expect(r.status).toBe('needs_you');
    expect(r.value).toBeNull();
  });
  it('a campus rule written with --force-unverified is never the source of the number', async () => {
    const r = await ask(facts({ campusRule: { ...CAMPUS, unverified: true } }));
    expect(r.status).toBe('needs_you');
    expect(r.value).toBeNull();
  });
  it('a percentage the university printed (direct) is still the student\'s own number and fills', async () => {
    const r = await ask(facts({ campusName: 'Test College affiliated to VTU', campusRule: null, eligibility: { confirmed: true, grad_score: 7.8, grad_scale: 10, grad_conversion: 'direct', grad_pct_equiv: 76.5 } }));
    expect(r).toMatchObject({ status: 'filled', value: '76.5%' });
  });
  it('no campus name (older facts) behaves as before', async () => {
    expect((await ask(facts({ campusName: undefined }))).status).toBe('filled');
  });
});

describe('eligibilityFromRow', () => {
  it('carries the stored scheme and admission year, numbers as numbers', () => {
    expect(eligibilityFromRow({ grad_score: '7.80', university_scheme: '2018', admission_year: 2018 })).toMatchObject({ grad_score: 7.8, university_scheme: '2018', admission_year: 2018 });
    expect(eligibilityFromRow({ grad_score: '7.80', university_scheme: null, admission_year: null })).not.toHaveProperty('university_scheme');
  });
});
