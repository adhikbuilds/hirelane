/**
 * engine:eval hook: layout-aware PDF text (RP1). Positioned-item fixtures, no PDF library.
 * Gates: the two-column and table variants parse into the same education fields as the single-column one (100%);
 * 0 single-column pages (including right-aligned dates) read as two columns; 0 tables missed.
 */
import { parseEducation } from '../../src/resume/education';
import { reconstructText } from '../../src/resume/layout';
import { normalizeResumeText } from '../../src/resume/sections';
import { eduSet, singleColumn, tableResume, twoColumn } from '../../test/helpers/layout-items';

const SETS = [
  eduSet('B.Tech Computer Science', 'RGPV', 2022, '8.1', 'CBSE', 81, 88),
  eduSet('B.E. Mechanical Engineering', 'VTU', 2021, '7.4', 'CBSE', 72, 79),
  eduSet('B.Tech Information Technology', 'AKTU', 2020, '6.9', 'CBSE', 65, 70),
  eduSet('B.Tech Electronics and Communication', 'JNTUH', 2023, '8.8', 'CBSE', 90, 94),
  eduSet('B.Tech Civil Engineering', 'SPPU', 2019, '7.0', 'CBSE', 60, 68),
  eduSet('B.Tech Computer Science', 'GTU', 2022, '9.2', 'CBSE', 85, 91),
  eduSet('B.E. Computer Engineering', 'Anna University', 2021, '8.0', 'CBSE', 77, 83),
  eduSet('B.Tech Electrical Engineering', 'MAKAUT', 2022, '7.7', 'CBSE', 74, 80),
];

const fields = (text: string) =>
  JSON.stringify(parseEducation(normalizeResumeText(text)).entries.map(({ level, board, score, startYear, passoutYear, degree, branch, confidence }) => ({ level, board, score, startYear, passoutYear, degree, branch, confidence })));

export default {
  name: 'layout  (positioned-item fixtures: single, two-column, table)',
  run() {
    let same = 0;
    let total = 0;
    let falseTwoCol = 0;
    let missedCol = 0;
    let missedTable = 0;
    const misses: string[] = [];
    SETS.forEach((edu, i) => {
      const a = reconstructText([singleColumn(edu)]);
      const b = reconstructText([twoColumn(edu)]);
      const c = reconstructText([tableResume(edu)]);
      if (a.columns === 2) falseTwoCol++;
      if (b.columns !== 2) missedCol++;
      if (c.tables < 1) missedTable++;
      const ref = fields(a.text);
      for (const [name, r] of [['two-column', b], ['table', c]] as const) {
        total++;
        if (fields(r.text) === ref) same++;
        else misses.push(`set ${i} ${name}`);
      }
    });
    const ok = total > 0 && same === total && falseTwoCol === 0 && missedCol === 0 && missedTable === 0;
    return {
      ok,
      lines: [
        `${SETS.length} synthetic students x 3 layouts: same education fields as single-column ${same}/${total} (must be 100%)`,
        `single-column read as two columns ${falseTwoCol} (must be 0); two-column missed ${missedCol} (must be 0); table missed ${missedTable} (must be 0)`,
        ...misses.slice(0, 5).map((m) => '  ' + m),
      ],
    };
  },
};
