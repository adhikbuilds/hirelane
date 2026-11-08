import { describe, expect, it } from 'vitest';
import { extractJobPostings } from '../src/jsonld/extract';
import { jf } from './jsonld.helpers';

describe('extractJobPostings', () => {
  it('finds a plain JobPosting block', () => {
    const r = extractJobPostings(jf('job-graduate-engineer-bengaluru.html'));
    expect(r).toHaveLength(1);
    expect(r[0]!['title']).toBe('Graduate Engineer (2026 batch)');
  });
  it('finds a JobPosting inside @graph with an array @type', () => {
    const r = extractJobPostings(jf('job-data-analyst-chicago.html'));
    expect(r.map((x) => x['title'])).toEqual(['Data Analyst']);
  });
  it('skips malformed JSON and non-JobPosting blocks', () => {
    expect(extractJobPostings(jf('job-no-markup.html'))).toEqual([]);
  });
  it('handles top-level arrays, single-quoted type attr and mixed case', () => {
    const html = `<SCRIPT TYPE='application/ld+json'>[{"@type":"JobPosting","title":"A"},{"@type":"JobPosting","title":"B"}]</SCRIPT>`;
    expect(extractJobPostings(html).map((x) => x['title'])).toEqual(['A', 'B']);
  });
  it('ignores other script types and plain text mentions', () => {
    expect(extractJobPostings('<script>{"@type":"JobPosting","title":"x"}</script> JobPosting')).toEqual([]);
  });
  it('never returns page html: only the parsed objects', () => {
    const r = extractJobPostings(jf('job-graduate-engineer-bengaluru.html'));
    expect(JSON.stringify(r)).not.toContain('secret page html');
  });
  it('caps blocks and block size', () => {
    const big = `<script type="application/ld+json">{"@type":"JobPosting","title":"${'x'.repeat(600_000)}"}</script>`;
    expect(extractJobPostings(big)).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => `<script type="application/ld+json">{"@type":"JobPosting","title":"t${i}"}</script>`).join('');
    expect(extractJobPostings(many).length).toBeLessThanOrEqual(20);
  });
});
