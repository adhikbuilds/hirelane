import { describe, expect, it } from 'vitest';
import { parseCriteria } from '../src/eligibility';
import type { Criterion } from '../src/eligibility/types';

const one = <T extends Criterion['type']>(text: string, type: T): Extract<Criterion, { type: T }> => {
  const hit = parseCriteria(text).filter((c) => c.type === type);
  expect(hit, text).toHaveLength(1);
  return hit[0] as Extract<Criterion, { type: T }>;
};

describe('parseCriteria', () => {
  it('returns [] for empty, whitespace and non-string input', () => {
    expect(parseCriteria('')).toEqual([]);
    expect(parseCriteria('   \n ')).toEqual([]);
    expect(parseCriteria(null as unknown as string)).toEqual([]);
    expect(parseCriteria(undefined as unknown as string)).toEqual([]);
  });

  it('parses "60% or 6.0 CGPA throughout" across three levels', () => {
    const c = one('60% or 6.0 CGPA throughout in 10th, 12th and graduation', 'min_score');
    expect(c.levels.sort()).toEqual(['10th', '12th', 'ug']);
    expect(c.pct).toBe(60);
    expect(c.cgpa).toBe(6);
    expect(c.throughout).toBe(true);
  });

  it('keeps a CGPA-only criterion distinguishable: pct is not a finite number', () => {
    const c = one('Minimum 6.5 CGPA in graduation', 'min_score');
    expect(Number.isFinite(c.pct)).toBe(false);
    expect(c.cgpa).toBe(6.5);
  });

  it('pairs 12th with diploma only when the notice does', () => {
    expect(one('Minimum 60% in 12th/Diploma', 'min_score').levels.sort()).toEqual(['12th', 'diploma']);
    expect(one('Minimum 60% in 12th', 'min_score').levels).toEqual(['12th']);
  });

  it('does not read years, counts or >100 numbers as scores', () => {
    expect(parseCriteria('Scored 150% of target in 2026, 12 openings')).toEqual([]);
  });

  it('expands YOP ranges but treats a long "batch" range as a session', () => {
    expect(one('YOP 2024-2026', 'passout_years').years).toEqual([2024, 2025, 2026]);
    expect(one('Batch 2022-2026', 'passout_years').years).toEqual([2026]);
  });

  it('keeps bare IT and "should be" from being branches or degrees', () => {
    expect(parseCriteria('We hire in IT and it should be fun to be here')).toEqual([]);
  });

  it('drops the parenthesised branch of a non-engineering degree', () => {
    const cs = parseCriteria('M.Sc (CS/IT) only');
    expect(cs.map((c) => c.type)).toEqual(['degrees']);
  });

  it('maps "circuit branches" through the alias group', () => {
    expect(one('Open to circuit branches', 'branches').list.sort()).toEqual(['ECE', 'EEE', 'EIE']);
  });

  it('evidence slices contain the matched token', () => {
    const text = 'Eligibility: minimum 65% aggregate in graduation. No active backlogs.';
    const cs = parseCriteria(text);
    const score = cs.find((c) => c.type === 'min_score')!;
    const s = score.evidence[0]!;
    expect(text.slice(s.start, s.end)).toContain('65%');
    const bl = cs.find((c) => c.type === 'no_active_backlogs')!;
    expect(text.slice(bl.evidence[0]!.start, bl.evidence[0]!.end).toLowerCase()).toContain('backlog');
  });

  it('is case-insensitive for words and handles unicode noise', () => {
    expect(parseCriteria('NO ACTIVE BACKLOGS 🎓 – 2026 BATCH ONLY').map((c) => c.type).sort()).toEqual(['no_active_backlogs', 'passout_years']);
  });

  it('is fast on large input', () => {
    const big = 'Minimum 60% in 12th. '.repeat(5000);
    const t = Date.now();
    parseCriteria(big);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
