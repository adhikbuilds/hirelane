import { describe, expect, it } from 'vitest';
import { EligibilityValues } from '../src/eligibility';
import { ParsedResume } from '../src/parsed';
import { deriveFieldMeta } from '../src/provenance';

const parsed = ParsedResume.parse({
  text: 'x',
  education: [
    { level: '10th', board: 'CBSE', score: { kind: 'percent', value: 91.2, scale: 100 }, confidence: 'high' },
    { level: '12th', board: 'CBSE', score: { kind: 'percent', value: 85, scale: 100 }, confidence: 'low' },
    { level: 'ug', degree: 'B.Tech', branch: 'Computer Science', passoutYear: 2026, score: { kind: 'cgpa', value: 8.2, scale: 10 }, confidence: 'high' },
  ],
  backlogs: { active: 0, history: 1 },
});

describe('deriveFieldMeta', () => {
  it('keeps source resume and the parser confidence for values equal to the parse', () => {
    const meta = deriveFieldMeta(EligibilityValues.parse({ pct_10: 91.2, pct_secondary: 85, grad_score: 8.2, grad_scale: 10, passout_year: 2026, active_backlogs: 0 }), parsed);
    expect(meta.pct_10).toEqual({ source: 'resume', confidence: 'high' });
    expect(meta.pct_secondary).toEqual({ source: 'resume', confidence: 'low' });
    expect(meta.grad_score).toEqual({ source: 'resume', confidence: 'high' });
    expect(meta.active_backlogs).toEqual({ source: 'resume', confidence: 'high' });
  });

  it('marks an edited value, a typed value and a field the parser has no opinion on as user', () => {
    const meta = deriveFieldMeta(EligibilityValues.parse({ pct_10: 95, gap_years: 1, grad_conversion: 'direct', board_10: 'cbse' }), parsed);
    expect(meta.pct_10).toEqual({ source: 'user', confidence: 'high' });
    expect(meta.gap_years).toEqual({ source: 'user', confidence: 'high' });
    expect(meta.grad_conversion).toEqual({ source: 'user', confidence: 'high' });
    expect(meta.board_10).toEqual({ source: 'resume', confidence: 'high' }); // same value, case-insensitive
  });

  it('records nothing for omitted fields and treats a value the parser did not find as user', () => {
    const empty = ParsedResume.parse({ text: '' });
    const meta = deriveFieldMeta(EligibilityValues.parse({ pct_10: 70 }), empty);
    expect(Object.keys(meta)).toEqual(['pct_10']);
    expect(meta.pct_10?.source).toBe('user');
  });
});

describe('EligibilityValues.grad_conversion', () => {
  it('rejects upper-case values cleanly instead of letting the lower-case DB CHECK fail', () => {
    expect(EligibilityValues.safeParse({ grad_conversion: 'DIRECT' }).success).toBe(false);
    expect(EligibilityValues.safeParse({ grad_conversion: 'direct' }).success).toBe(true);
    expect(EligibilityValues.safeParse({ grad_conversion: 'campus:11111111-1111-4111-8111-111111111111' }).success).toBe(true);
    expect(EligibilityValues.safeParse({ grad_conversion: 'campus:11111111-1111-4111-8111-11111111111A' }).success).toBe(false);
  });
});
