import { describe, expect, it } from 'vitest';
import { evaluate, formatReport, type Stats } from '../report-coverage-lib';

const base: Stats = {
  openJobs: 1000,
  withSalary: 200,
  salaryStatedAnywhere: 300,
  salaryAmongStated: 200,
  salaryWithoutTrace: 0,
  withMustRequirement: 950,
  withGeo: 995,
  withRoleFamily: 970,
  workplaceKnown: 900,
  levelKnown: 800,
  postings: { total: 1100, open: 1100, linked: 1100, openUnlinked: 0 },
  clusters: { jobsWithMultiplePostings: 50, mergedPostings: 100 },
  llmCalls: 0,
};

describe('evaluate', () => {
  it('passes a healthy run', () => {
    const r = evaluate(base);
    expect(r.checks.every((c) => c.pass)).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('measures salary against the stated-anywhere ceiling and against all jobs', () => {
    const r = evaluate(base);
    expect(r.salaryOfCeiling).toBeCloseTo(200 / 300);
    expect(r.salaryOfAll).toBeCloseTo(0.2);
    expect(r.ceilingOfAll).toBeCloseTo(0.3);
  });

  it.each([
    ['salary capture below 50% of the ceiling', { withSalary: 100, salaryAmongStated: 100 }, 'salary'],
    ['a salaried job without a trace', { salaryWithoutTrace: 1 }, 'trace'],
    ['must requirements below 90%', { withMustRequirement: 899 }, 'must'],
    ['geo below 98%', { withGeo: 979 }, 'country'],
    ['role family below 95%', { withRoleFamily: 949 }, 'role'],
    ['any llm call', { llmCalls: 1 }, 'llm'],
    ['unlinked open postings', { postings: { total: 10, open: 10, linked: 9, openUnlinked: 1 } }, 'linked'],
  ] as const)('fails on %s', (_n, patch, word) => {
    const r = evaluate({ ...base, ...patch } as Stats);
    expect(r.ok).toBe(false);
    expect(r.checks.filter((c) => !c.pass).map((c) => c.name.toLowerCase()).join(' ')).toContain(word);
  });

  it('handles an empty database without dividing by zero', () => {
    const r = evaluate({ ...base, openJobs: 0, withSalary: 0, salaryStatedAnywhere: 0, salaryAmongStated: 0, withMustRequirement: 0, withGeo: 0, withRoleFamily: 0 });
    expect(r.ok).toBe(false);
    expect(Number.isNaN(r.salaryOfCeiling)).toBe(false);
  });

  it('formats percentages and names the gate', () => {
    const text = formatReport(evaluate(base), base);
    expect(text).toContain('llm_calls=0');
    expect(text).toContain('66.7%');
    expect(text).toMatch(/PASS/);
  });
});
