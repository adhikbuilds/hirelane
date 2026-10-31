import { describe, expect, it } from 'vitest';
import { buildPicks, type Pick } from '../src/picks';
import { hardFailure, runPicksEval, summarize } from '../src/picks/eval';

// The eval runs in `pnpm test` (and so in `pnpm verify`) as well as through `pnpm --filter @hirelane/services picks:eval`.
describe('picks eval: no pick may violate a hard eligibility rule', () => {
  it('passes for the real picker, on a corpus that really offers hard fails to refuse', () => {
    const r = runPicksEval();
    const s = summarize(r);
    expect(s.lines.join('\n')).toContain('0 violations');
    expect(r.unreadRules).toEqual([]);
    expect(r.hardFailsOffered).toBeGreaterThan(200);
    expect(r.picksShown).toBeGreaterThan(100);
    expect(s.ok).toBe(true);
  });

  it('passes on other seeds too', () => {
    for (const seed of [1, 7, 99, 12345]) expect(summarize(runPicksEval({ seed, profiles: 30 })).ok, `seed ${seed}`).toBe(true);
  });

  it('FAILS when a picker lets a hard fail through (a picker with the eligibility gate removed)', () => {
    const leaky = (input: Parameters<typeof buildPicks>[0]): Pick[] => buildPicks({ ...input, profile: null });
    const r = runPicksEval({ pick: leaky });
    expect(r.violations.length).toBeGreaterThan(0);
    expect(summarize(r).ok).toBe(false);
    expect(summarize(r).lines.join('\n')).toMatch(/VIOLATION/);
  });

  it('FAILS when a picker shows nothing at all, because that proves nothing', () => {
    const r = runPicksEval({ pick: () => [] });
    expect(r.violations).toEqual([]);
    expect(summarize(r).ok).toBe(false);
  });

  it('the judge is plain arithmetic: it fails a number under the minimum and never an unknown', () => {
    expect(hardFailure({ gradMin: 60 }, { grad: 59.9 })).toMatch(/under 60/);
    expect(hardFailure({ gradMin: 60 }, { grad: 60 })).toBeNull();
    expect(hardFailure({ gradMin: 60 }, {})).toBeNull();
    expect(hardFailure({ noBacklog: true }, { backlogs: 1 })).toMatch(/backlog/);
    expect(hardFailure({ passout: 2026 }, { passout: 2025 })).toMatch(/passout/);
    expect(hardFailure({}, { grad: 1 })).toBeNull();
  });
});
