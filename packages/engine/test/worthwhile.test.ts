import { describe, expect, it } from 'vitest';
import { isWorthwhile, WORTHWHILE_MIN_MUST_RATIO, WORTHWHILE_MAX_CHECK_AGE_DAYS, type WorthwhileInput } from '../src/worthwhile';
import { EngineInvariantError } from '../src/errors';

const NOW = '2026-10-28T00:00:00Z';
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * DAY).toISOString();
const base = (over: { job?: Partial<WorthwhileInput['job']>; evidence?: WorthwhileInput['evidence']; user?: WorthwhileInput['user'] } = {}): WorthwhileInput => ({
  job: { fresher: true, open: true, lastCheckedAt: daysAgo(1), payStated: true, remote: false, locations: ['Bengaluru'], ...over.job },
  evidence: over.evidence ?? { mustMet: 3, mustTotal: 4 },
  user: over.user ?? { cities: ['Bengaluru'], remote: false },
  now: NOW,
});
const cond = (r: ReturnType<typeof isWorthwhile>, name: string) => r.conditions.find((c) => c.name === name)!;

describe('isWorthwhile', () => {
  it('constants match the A8 rule', () => {
    expect(WORTHWHILE_MIN_MUST_RATIO).toBe(0.6);
    expect(WORTHWHILE_MAX_CHECK_AGE_DAYS).toBe(14);
  });
  it('passes when all four gates pass and lists them with details', () => {
    const r = isWorthwhile(base());
    expect(r.worthwhile).toBe(true);
    expect(r.conditions.map((c) => c.name)).toEqual(['fresher_eligible', 'must_haves_met', 'job_open', 'recently_checked']);
    for (const c of r.conditions) {
      expect(c.pass).toBe(true);
      expect(c.detail).not.toBe('');
    }
  });
  it('fails when not fresher', () => {
    const r = isWorthwhile(base({ job: { fresher: false } }));
    expect(r.worthwhile).toBe(false);
    expect(cond(r, 'fresher_eligible').pass).toBe(false);
  });
  it('fails when closed', () => {
    const r = isWorthwhile(base({ job: { open: false } }));
    expect(r.worthwhile).toBe(false);
    expect(cond(r, 'job_open').pass).toBe(false);
  });
  it('must-have boundary: 60% passes, just below fails', () => {
    expect(isWorthwhile(base({ evidence: { mustMet: 3, mustTotal: 5 } })).worthwhile).toBe(true);
    expect(isWorthwhile(base({ evidence: { mustMet: 6, mustTotal: 10 } })).worthwhile).toBe(true);
    const r = isWorthwhile(base({ evidence: { mustMet: 59, mustTotal: 100 } }));
    expect(r.worthwhile).toBe(false);
    expect(cond(r, 'must_haves_met').detail).toContain('59/100');
    expect(isWorthwhile(base({ evidence: { mustMet: 2, mustTotal: 5 } })).worthwhile).toBe(false);
  });
  it('no must-haves listed passes vacuously with an explanatory detail', () => {
    const r = isWorthwhile(base({ evidence: { mustMet: 0, mustTotal: 0 } }));
    expect(cond(r, 'must_haves_met').pass).toBe(true);
    expect(cond(r, 'must_haves_met').detail).toMatch(/no must/i);
  });
  it('check age boundary: 14 days passes, 14.5 fails', () => {
    expect(isWorthwhile(base({ job: { lastCheckedAt: daysAgo(14) } })).worthwhile).toBe(true);
    const r = isWorthwhile(base({ job: { lastCheckedAt: daysAgo(14.5) } }));
    expect(r.worthwhile).toBe(false);
    expect(cond(r, 'recently_checked').pass).toBe(false);
  });
  it('never checked or unparseable timestamp fails; future timestamp counts as fresh', () => {
    expect(cond(isWorthwhile(base({ job: { lastCheckedAt: null } })), 'recently_checked').pass).toBe(false);
    expect(cond(isWorthwhile(base({ job: { lastCheckedAt: 'not a date' } })), 'recently_checked').pass).toBe(false);
    expect(cond(isWorthwhile(base({ job: { lastCheckedAt: daysAgo(-2) } })), 'recently_checked').pass).toBe(true);
  });
  it('accepts Date and epoch-ms for now and lastCheckedAt', () => {
    const input = base();
    expect(isWorthwhile({ ...input, now: new Date(NOW) }).worthwhile).toBe(true);
    expect(isWorthwhile({ ...input, now: Date.parse(NOW), job: { ...input.job, lastCheckedAt: new Date(daysAgo(2)) } }).worthwhile).toBe(true);
  });
  it('pay and location never gate, but are reported as info', () => {
    const r = isWorthwhile(base({ job: { payStated: false, locations: ['Tokyo'] } }));
    expect(r.worthwhile).toBe(true);
    expect(r.info.payStated).toBe(false);
    expect(r.info.locationFit).toBe(false);
  });
  it('location fit: city match (case/diacritic-insensitive), remote match, no preference', () => {
    expect(isWorthwhile(base({ job: { locations: ['BENGALURU, India'] }, user: { cities: ['bengaluru'], remote: false } })).info.locationFit).toBe(true);
    expect(isWorthwhile(base({ job: { remote: true, locations: [] }, user: { cities: ['Pune'], remote: true } })).info.locationFit).toBe(true);
    expect(isWorthwhile(base({ job: { remote: true, locations: [] }, user: { cities: ['Pune'], remote: false } })).info.locationFit).toBe(false);
    expect(isWorthwhile(base({ user: { cities: [], remote: false } })).info.locationFit).toBe(true);
  });
  it('rejects invalid evidence counts', () => {
    for (const evidence of [{ mustMet: -1, mustTotal: 3 }, { mustMet: 4, mustTotal: 3 }, { mustMet: 1.5, mustTotal: 3 }, { mustMet: Number.NaN, mustTotal: 3 }]) {
      expect(() => isWorthwhile(base({ evidence }))).toThrow(EngineInvariantError);
    }
  });
  it('rejects an invalid now', () => {
    expect(() => isWorthwhile({ ...base(), now: 'garbage' })).toThrow(EngineInvariantError);
  });
  it('is deterministic and pure; conditions fully explain worthwhile (property grid)', () => {
    for (const fresher of [true, false]) for (const open of [true, false]) for (const age of [0, 13.9, 14, 15, 90]) for (const [m, t] of [[0, 0], [1, 2], [3, 5], [2, 5], [5, 5]] as const) {
      const input = base({ job: { fresher, open, lastCheckedAt: daysAgo(age) }, evidence: { mustMet: m, mustTotal: t } });
      const snap = JSON.stringify(input);
      const a = isWorthwhile(input);
      expect(a).toEqual(isWorthwhile(input));
      expect(JSON.stringify(input)).toBe(snap);
      expect(a.worthwhile).toBe(a.conditions.every((c) => c.pass));
      const expected = fresher && open && age <= 14 && (t === 0 || m * 5 >= t * 3);
      expect(a.worthwhile, `${fresher} ${open} ${age} ${m}/${t}`).toBe(expected);
    }
  });
});
