import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scorePastedJobs } from '../src/jobtext/score';

describe('pasted-jobs corpus gates', () => {
  const s = scorePastedJobs(readFileSync(new URL('./corpus/pasted-jobs.labelled.jsonl', import.meta.url), 'utf8'));
  it('has at least 60 rows in all three paste styles plus drive notices', () => {
    expect(s.rows).toBeGreaterThanOrEqual(60);
    for (const k of ['naukri', 'linkedin', 'whatsapp', 'drive']) expect(s.byStyle[k] ?? 0, k).toBeGreaterThan(5);
  });
  it('title accuracy >= 0.90', () => expect(s.title, s.misses.title.join('; ')).toBeGreaterThanOrEqual(0.9));
  it('company accuracy >= 0.90', () => expect(s.company, s.misses.company.join('; ')).toBeGreaterThanOrEqual(0.9));
  it('criteria accuracy >= 0.90', () => expect(s.criteria, s.misses.criteria.join('; ')).toBeGreaterThanOrEqual(0.9));
  it('source hint accuracy >= 0.90', () => expect(s.source, s.misses.source.join('; ')).toBeGreaterThanOrEqual(0.9));
  it('fresher flag accuracy >= 0.90', () => expect(s.fresher, s.misses.fresher.join('; ')).toBeGreaterThanOrEqual(0.9));
});
