import { describe, expect, it } from 'vitest';
import { parseEducation } from '../src/resume/education';
import { normalizeResumeText } from '../src/resume/sections';

const one = (t: string) => parseEducation(normalizeResumeText(t)).entries[0]!;

describe('education parser reads RP3 formats', () => {
  it('marks written as 412/500 become 82.4%', () => {
    const e = one('Class XII, CBSE, 412/500, 2022');
    expect(e.level).toBe('12th');
    expect(e.score).toEqual({ kind: 'percent', value: 82.4, scale: 100 });
    expect(e.confidence).toBe('high');
  });
  it('marks out of 1200 and "out of"', () => {
    expect(one('HSC, Maharashtra State Board, 1020/1200, 2021').score).toMatchObject({ kind: 'percent', value: 85 });
    expect(one('Class X, CBSE, 412 out of 500, 2020').score).toMatchObject({ kind: 'percent', value: 82.4 });
  });
  it('a date like 06/2022 is not marks', () => {
    const e = one('B.Tech CSE, RGPV, 06/2022 - 05/2026, CGPA 8.1/10');
    expect(e.score).toMatchObject({ kind: 'cgpa', value: 8.1 });
  });
  it("Jun'22 – May'26 gives the years, with straight and curly apostrophes", () => {
    for (const apos of ["'", '’']) {
      const e = one(`B.Tech Computer Science, RGPV, Jun${apos}22 – May${apos}26, CGPA 8.1/10`);
      expect([e.startYear, e.passoutYear], apos).toEqual([2022, 2026]);
    }
  });
  it('2022–26 and Pursuing', () => {
    const a = one('B.Tech CSE, RGPV, 2022–26, CGPA 8.1/10');
    expect([a.startYear, a.passoutYear]).toEqual([2022, 2026]);
    const b = one('B.Tech CSE, RGPV, 2022 – Pursuing, CGPA 8.1/10');
    expect(b.startYear).toBe(2022);
  });
});
