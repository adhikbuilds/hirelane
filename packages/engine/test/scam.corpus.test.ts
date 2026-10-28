import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scoreScamCorpus } from '../src/jobtext/score';

describe('scam corpus gates', () => {
  const raw = readFileSync(new URL('./corpus/scam.labelled.jsonl', import.meta.url), 'utf8');
  const s = scoreScamCorpus(raw);
  it('has at least 50 labelled lines, both classes', () => {
    expect(s.total).toBeGreaterThanOrEqual(50);
    expect(s.scam).toBeGreaterThanOrEqual(20);
    expect(s.legit).toBeGreaterThanOrEqual(20);
  });
  it('recall >= 0.95', () => expect(s.recall, s.missed.join(',')).toBeGreaterThanOrEqual(0.95));
  it('false positives <= 5% of legit', () => expect(s.fpRate, s.falsePositives.join(',')).toBeLessThanOrEqual(0.05));
});
