import { describe, expect, it } from 'vitest';
import { boundedArray, boundedString, evidenceQuote, validateExtraction } from '../src/llm/validate';

const sent = [
  { id: 'job-1', text: 'We need 5+ years of TypeScript.\nNice to have: Kubernetes experience.' },
  { id: 'job-2', text: 'Salary: ₹18-25 LPA. Hybrid in Bengaluru.' },
];

describe('validateExtraction', () => {
  it('accepts results whose evidence occurs in the source, ignoring case and whitespace', () => {
    const r = validateExtraction(sent, [{ id: 'job-1', evidence: ['5+ years of   typescript'] }]);
    expect(r.accepted.map((a) => a.id)).toEqual(['job-1']);
    expect(r.rejected).toEqual([]);
  });

  it('rejects ids that were never sent', () => {
    const r = validateExtraction(sent, [{ id: 'job-9', evidence: ['TypeScript'] }]);
    expect(r.rejected).toEqual([{ id: 'job-9', reason: 'unknown_id' }]);
  });

  it('rejects a second result for the same id', () => {
    const r = validateExtraction(sent, [
      { id: 'job-2', evidence: ['Hybrid in Bengaluru'] },
      { id: 'job-2', evidence: ['18-25 LPA'] },
    ]);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toEqual([{ id: 'job-2', reason: 'duplicate_id' }]);
  });

  it('rejects a quote the model invented', () => {
    const r = validateExtraction(sent, [{ id: 'job-1', evidence: ['visa sponsorship available'] }]);
    expect(r.rejected[0]).toMatchObject({ id: 'job-1', reason: 'evidence_not_in_source' });
  });

  it('rejects quotes from a different item in the same batch', () => {
    const r = validateExtraction(sent, [{ id: 'job-1', evidence: ['18-25 LPA'] }]);
    expect(r.rejected[0]?.reason).toBe('evidence_not_in_source');
  });

  it('requires evidence unless told otherwise', () => {
    expect(validateExtraction(sent, [{ id: 'job-1', evidence: [] }]).rejected[0]?.reason).toBe('no_evidence');
    expect(validateExtraction(sent, [{ id: 'job-1', evidence: [] }], { requireEvidence: false }).accepted).toHaveLength(1);
  });
});

describe('bounded schema helpers', () => {
  it('cap string and array sizes', () => {
    expect(boundedString(5).safeParse('abcdef').success).toBe(false);
    expect(evidenceQuote().safeParse('x'.repeat(301)).success).toBe(false);
    expect(boundedArray(boundedString(), 2).safeParse(['a', 'b', 'c']).success).toBe(false);
    expect(boundedArray(boundedString(), 2).safeParse(['a', 'b']).success).toBe(true);
  });
});
