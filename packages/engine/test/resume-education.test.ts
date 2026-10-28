import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBacklogs, parseEducation } from '../src/resume/education';
import { normalizeResumeText } from '../src/resume/sections';
import type { Backlogs, EducationEntry } from '../src/resume/types';

const here = dirname(fileURLToPath(import.meta.url));

type Exp = Omit<EducationEntry, 'evidence'>;
interface Row {
  id: string;
  text: string;
  education: Exp[];
  backlogs: Backlogs;
  lateralEntry: boolean;
}
function load(name: string): Row[] {
  const lines = readFileSync(join(here, 'corpus', name), 'utf8').split('\n').filter((l) => l.trim());
  expect(JSON.parse(lines[0]!)._header.labelledBy).toMatch(/Claude/);
  return lines.slice(1).map((l) => JSON.parse(l) as Row);
}
const run = (text: string) => parseEducation(normalizeResumeText(text));
const one = (text: string): EducationEntry => {
  const r = run(text);
  expect(r.entries).toHaveLength(1);
  return r.entries[0]!;
};

describe('score parsing', () => {
  it('reads a percentage', () => {
    expect(one('Class X, CBSE, 2019, 92.4%').score).toEqual({ kind: 'percent', value: 92.4, scale: 100 });
    expect(one('Class X, CBSE, 2019, Percentage: 92.4').score).toEqual({ kind: 'percent', value: 92.4, scale: 100 });
    expect(one('Class X, CBSE, 2019, 92.4 percent').score?.value).toBe(92.4);
  });
  it('reads CGPA with an explicit scale of 10, 4 or 5', () => {
    expect(one('B.Tech CSE 2022-2026 CGPA: 8.5/10').score).toEqual({ kind: 'cgpa', value: 8.5, scale: 10 });
    expect(one('B.Tech CSE 2022-2026 GPA 3.6 / 4.0').score).toEqual({ kind: 'cgpa', value: 3.6, scale: 4 });
    expect(one('B.Tech CSE 2022-2026 CGPA 4.4 out of 5').score).toEqual({ kind: 'cgpa', value: 4.4, scale: 5 });
    expect(one('B.Tech CSE 2022-2026 8.25 CGPA').score).toEqual({ kind: 'cgpa', value: 8.25, scale: 10 });
    expect(one('B.Tech CSE 2022-2026 8.25/10').score).toEqual({ kind: 'cgpa', value: 8.25, scale: 10 });
  });
  it('defaults an unstated CGPA scale to 10 for 4.1-10 and flags <= 4 as low confidence on scale 4', () => {
    const a = one('B.Tech CSE 2022-2026 CGPA 8.5');
    expect(a.score).toEqual({ kind: 'cgpa', value: 8.5, scale: 10 });
    expect(a.confidence).toBe('high');
    const b = one('B.Tech CSE 2022-2026 CGPA 3.4');
    expect(b.score).toEqual({ kind: 'cgpa', value: 3.4, scale: 4 });
    expect(b.confidence).toBe('low');
  });
  it('out-of-range scores are kept as written with low confidence, never clamped', () => {
    const p = one('Class X, CBSE, 2019, 112%');
    expect(p.score).toEqual({ kind: 'percent', value: 112, scale: 100 });
    expect(p.confidence).toBe('low');
    const c = one('B.Tech CSE 2022-2026 CGPA: 11.2/10');
    expect(c.score).toEqual({ kind: 'cgpa', value: 11.2, scale: 10 });
    expect(c.confidence).toBe('low');
    const d = one('B.Tech CSE 2022-2026 CGPA 85');
    expect(d.score).toEqual({ kind: 'cgpa', value: 85, scale: 10 });
    expect(d.confidence).toBe('low');
    const e = one('B.Tech CSE 2022-2026 CGPA 4.6/4.0');
    expect(e.score).toEqual({ kind: 'cgpa', value: 4.6, scale: 4 });
    expect(e.confidence).toBe('low');
  });
  it('an SGPA alone is accepted but low confidence; a CGPA beside it wins', () => {
    const s = one('B.Tech CSE 2022-2026 SGPA: 8.1 (Sem 5)');
    expect(s.score).toEqual({ kind: 'cgpa', value: 8.1, scale: 10 });
    expect(s.confidence).toBe('low');
    const both = one('B.Tech CSE 2022-2026 SGPA: 7.9 CGPA: 8.3');
    expect(both.score?.value).toBe(8.3);
    expect(both.confidence).toBe('high');
  });
  it('a missing score is null and low confidence', () => {
    const e = one('Class XII, CBSE, 2021');
    expect(e.score).toBeNull();
    expect(e.confidence).toBe('low');
  });
  it('year ranges are not read as scores', () => {
    expect(one('B.Tech CSE 2022 - 2026').score).toBeNull();
  });
});

describe('years', () => {
  it('reads ranges with en/em dashes, to, two-digit ends and month names', () => {
    for (const t of ['2022 - 2026', '2022-2026', '2022 – 2026', '2022 — 2026', '2022 to 2026', '2022-26', 'Aug 2022 – May 2026', '08/2022 - 06/2026']) {
      const e = one(`B.Tech CSE ${t} CGPA 8.0`);
      expect([e.startYear, e.passoutYear], t).toEqual([2022, 2026]);
    }
  });
  it('reads Expected, Batch of and single years as passout only', () => {
    for (const t of ['Expected 2026', '(Expected: May 2026)', 'Batch of 2026', 'Graduating 2026', 'Passout: 2026']) {
      const e = one(`B.Tech CSE ${t} CGPA 8.0`);
      expect([e.startYear, e.passoutYear], t).toEqual([null, 2026]);
    }
  });
  it('ongoing ranges give a start year only and low confidence', () => {
    const e = one('B.Tech CSE 2022 – Present CGPA 8.0');
    expect([e.startYear, e.passoutYear]).toEqual([2022, null]);
    expect(e.confidence).toBe('low');
  });
  it('a two-digit end that is really a score is not a year', () => {
    const e = one('Class XII CBSE 2020 – 85%');
    expect(e.passoutYear).toBe(2020);
    expect(e.score?.value).toBe(85);
  });
  it('flags an end before the start as low confidence', () => {
    expect(one('B.Tech CSE 2026 - 2022 CGPA 8.0').confidence).toBe('low');
  });
  it('flags a span far from the degree duration as low confidence, tolerating lateral entry', () => {
    expect(one('B.Tech CSE 2022 - 2023 CGPA 8.0').confidence).toBe('low');
    expect(one('B.E. (Lateral Entry) CSE 2023 - 2026 CGPA 8.0').confidence).toBe('high');
  });
});

describe('levels, boards, degrees and branches', () => {
  it.each([
    ['SSLC, Karnataka State Board, 2018, 91%', '10th', 'Karnataka State Board'],
    ['Class X (ICSE) 2018 91%', '10th', 'ICSE'],
    ['Matriculation, Bihar Board, 2018, 80%', '10th', 'Bihar Board'],
    ['10th Standard SSC Maharashtra Board 2018 91%', '10th', 'Maharashtra State Board'],
    ['II PUC, Karnataka PU Board, 2020, 89%', '12th', 'Karnataka PUC Board'],
    ['Intermediate (MPC), BIEAP, 2020, 96%', '12th', 'AP Board of Intermediate Education'],
    ['Class XII ISC 2020 90%', '12th', 'ISC'],
    ['HSC, Maharashtra State Board, 2020, 77.5%', '12th', 'Maharashtra State Board'],
    ['Senior Secondary (Class XII), CBSE, 2020, 90%', '12th', 'CBSE'],
    ['Plus Two, Kerala State Board, 2020, 90%', '12th', 'Kerala State Board'],
    ['12th, WBCHSE, West Bengal Council of Higher Secondary Education, 2020, 90%', '12th', 'WBCHSE'],
    ['10+2 State Board 2020 84%', '12th', 'State Board'],
  ])('%s', (text, level, board) => {
    const e = one(text);
    expect(e.level).toBe(level);
    expect(e.board).toBe(board);
    expect(e.degree).toBeNull();
    expect(e.branch).toBeNull();
  });

  it('a school name containing a level word is not a new record', () => {
    const r = run('Class X – CBSE\nSample Senior Secondary School | 2018 | 93%\nExample Composite PU College');
    expect(r.entries.map((e) => e.level)).toEqual(['10th']);
    expect(r.entries[0]!.passoutYear).toBe(2018);
  });

  it('degrees map to canonical ids and levels', () => {
    const cases: [string, string, string][] = [
      ['B.Tech (CSE) VTU 2022-2026 8.0 CGPA', 'btech', 'ug'],
      ['Bachelor of Engineering in Civil Engineering 2022-2026 8.0 CGPA', 'be', 'ug'],
      ['B.E. ECE 2022-2026 8.0 CGPA', 'be', 'ug'],
      ['BCA, KTU, 2021-2024, 80%', 'bca', 'ug'],
      ['M.Tech in VLSI Design, 2024-2026, 8.9 CGPA', 'mtech', 'pg'],
      ['MBA 2024-2026 71%', 'mba', 'pg'],
      ['Post Graduate Diploma in Management 2024-2026 71%', 'pgdm', 'pg'],
      ['Diploma in Computer Engineering, MSBTE, 2020-2023, 80%', 'diploma', 'diploma'],
    ];
    for (const [t, deg, lvl] of cases) {
      const e = one(t);
      expect([e.degree, e.level], t).toEqual([deg, lvl]);
    }
  });

  it('branch aliases normalise to codes; a college name does not leak a branch', () => {
    expect(one('B.Tech in Computer Science & Engineering 2022-2026 8.0 CGPA').branch).toBe('cse');
    expect(one('B.Tech (AI & DS) 2022-2026 8.0 CGPA').branch).toBe('aids');
    expect(one('B.E. (Electronics and Telecommunication) 2022-2026 8.0 CGPA').branch).toBe('ece');
    expect(one('B.Tech - IT 2022-2026 8.0 CGPA').branch).toBe('it');
    expect(one('B.Tech\nBranch: Mechanical Engineering\nSample Institute of Information Technology 2022-2026 8.0 CGPA').branch).toBe('mech');
    expect(one('BCA, Sample Institute of Information Technology, 2021-2024, 80%').branch).toBeNull();
    expect(one('B.Tech in Electrical and Electronics Engineering 2022-2026 8.0 CGPA').branch).toBe('eee');
  });

  it('"it" and "be" only match as upper-case abbreviations', () => {
    expect(one('B.Tech 2022-2026 8.0 CGPA, it was fun').branch).toBeNull();
    expect(run('to be or not 2022-2026 8.0 CGPA').entries).toEqual([]);
  });
});

describe('lateral entry and structure', () => {
  it('detects lateral entry from text and from diploma + degree without 12th', () => {
    expect(run('Diploma in Mechanical Engineering, MSBTE, 2020-2023, 81%\nB.E. Mechanical (Lateral Entry), VTU, 2023-2026, CGPA 7.9').lateralEntry).toBe(true);
    expect(run('Diploma in CSE, 2020-2023, 81%\nB.E. CSE, 2023-2026, CGPA 7.9').lateralEntry).toBe(true);
    expect(run('Class XII CBSE 2022 90%\nB.E. CSE, 2022-2026, CGPA 7.9').lateralEntry).toBe(false);
  });
  it('orders entries 10th, 12th, diploma, ug, pg regardless of text order', () => {
    const r = run('MBA 2024-2026 71%\nB.Tech CSE 2020-2024 8.0 CGPA\nClass XII CBSE 2020 90%\nClass X CBSE 2018 91%');
    expect(r.entries.map((e) => e.level)).toEqual(['10th', '12th', 'ug', 'pg']);
  });
  it('a flattened table (one row per line, header row first) parses', () => {
    const r = run('Education\nExamination | Board/University | Year | Percentage/CGPA\nSSLC | KSEEB | 2018 | 91.2%\nB.E. (ISE) | VTU | 2020-2024 | 8.45 CGPA');
    expect(r.entries.map((e) => [e.level, e.board, e.passoutYear])).toEqual([['10th', 'Karnataka State Board', 2018], ['ug', 'VTU', 2024]]);
  });
  it('a flattened table with one cell per line parses', () => {
    const r = run('Class X\nCBSE\n2019\n95.2%\nClass XII\nCBSE\n2021\n91.6%');
    expect(r.entries.map((e) => [e.level, e.score?.value, e.passoutYear])).toEqual([['10th', 95.2, 2019], ['12th', 91.6, 2021]]);
  });
  it('only reads the education section when the resume has headings', () => {
    const r = run('Name\n\nEducation\nB.Tech CSE 2022-2026 CGPA 8.0\n\nProjects\nFinal year B.Tech project, scored 95%, 2026\n\nAchievements\nClass X topper 2018 99%');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.degree).toBe('btech');
  });
  it('one entry per level: the more complete record wins', () => {
    const r = run('Pursuing B.Tech (Expected 2026)\nB.Tech CSE VTU 2022-2026 CGPA 8.0');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.score?.value).toBe(8);
  });
  it('an empty education block, empty text and nonsense give no entries', () => {
    expect(run('').entries).toEqual([]);
    expect(run('   \n  ').entries).toEqual([]);
    expect(run('Education\n').entries).toEqual([]);
    expect(run('😀😀😀 ; DROP TABLE users; --').entries).toEqual([]);
    expect(parseEducation(undefined as unknown as string).entries).toEqual([]);
    expect(parseEducation(42 as unknown as string).entries).toEqual([]);
  });
  it('a gap-year note is not an education record and does not change a record', () => {
    const r = run('Class XII CBSE 2021 85%\nGap year: 2021-2022 (entrance preparation)');
    expect(r.entries).toHaveLength(1);
    expect([r.entries[0]!.startYear, r.entries[0]!.passoutYear]).toEqual([null, 2021]);
  });
});

describe('evidence offsets', () => {
  it('spans index the normalised text and cover the level, board, score and years', () => {
    const text = normalizeResumeText('Name\n\nEducation\nB.Tech CSE, VTU, 2022 - 2026, CGPA: 8.5/10\n');
    const e = parseEducation(text).entries[0]!;
    const pieces = e.evidence.map((s) => text.slice(s.start, s.end));
    expect(pieces).toContain('B.Tech');
    expect(pieces).toContain('VTU');
    expect(pieces.some((p) => p.includes('2022') && p.includes('2026'))).toBe(true);
    expect(pieces.some((p) => p.includes('8.5'))).toBe(true);
    for (const s of e.evidence) {
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeGreaterThan(s.start);
      expect(s.end).toBeLessThanOrEqual(text.length);
    }
  });
});

describe('backlogs: active and history are separate', () => {
  const cases: [string, Backlogs][] = [
    ['No active backlogs', { active: 0, history: null }],
    ['No backlogs', { active: 0, history: null }],
    ['Backlogs: Nil', { active: 0, history: null }],
    ['Backlogs: 0', { active: 0, history: null }],
    ['Zero backlogs', { active: 0, history: null }],
    ['No standing arrears', { active: 0, history: null }],
    ['ATKT: 0', { active: 0, history: null }],
    ['KT: Nil | ATKT: Nil', { active: 0, history: null }],
    ['2 active backlogs', { active: 2, history: null }],
    ['Number of active backlogs: 1', { active: 1, history: null }],
    ['Backlog history: 3 (all cleared)', { active: null, history: 3 }],
    ['History of backlogs: 1', { active: null, history: 1 }],
    ['No backlog history', { active: null, history: 0 }],
    ['Active Backlogs: 0 | Backlog History: 2', { active: 0, history: 2 }],
    ['Currently 1 active backlog; 2 cleared backlogs', { active: 1, history: 2 }],
    ['Active backlogs: 0. Had 2 ATKT in Sem 2, cleared in the next attempt', { active: 0, history: 2 }],
    ['No active backlogs, no backlog history', { active: 0, history: 0 }],
    ['Current Backlogs - 0, Cleared Backlogs - 2', { active: 0, history: 2 }],
    ['Cleared 2 ATKT in Sem 3', { active: null, history: 2 }],
    ['Hobbies: reading', { active: null, history: null }],
    ['', { active: null, history: null }],
  ];
  it.each(cases)('%j', (text, want) => {
    expect(parseBacklogs(text)).toEqual(want);
  });
  it('finds a statement anywhere in the document, e.g. a biodata block', () => {
    expect(parseBacklogs('Name\n\nPersonal Details\nBacklogs: 1\n\nDeclaration\nx').active).toBe(1);
  });
  it('is tolerant of non-string input', () => {
    expect(parseBacklogs(null as unknown as string)).toEqual({ active: null, history: null });
  });
});

describe('labelled corpus accuracy', () => {
  function score(rows: Row[]) {
    let ok = 0;
    let total = 0;
    const misses: string[] = [];
    const cmp = (id: string, field: string, got: unknown, want: unknown) => {
      total++;
      if (JSON.stringify(got) === JSON.stringify(want)) ok++;
      else misses.push(`${id} ${field}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
    };
    for (const r of rows) {
      const res = run(r.text);
      for (const want of r.education) {
        const got = res.entries.find((e) => e.level === want.level);
        for (const f of ['board', 'score', 'startYear', 'passoutYear', 'degree', 'branch', 'confidence'] as const) cmp(r.id, `${want.level}.${f}`, got ? got[f] : '<missing>', want[f]);
      }
      for (const e of res.entries) {
        if (!r.education.some((w) => w.level === e.level)) {
          total += 1;
          misses.push(`${r.id} extra entry ${e.level}`);
        }
      }
      cmp(r.id, 'backlogs.active', res.backlogs.active, r.backlogs.active);
      cmp(r.id, 'backlogs.history', res.backlogs.history, r.backlogs.history);
      cmp(r.id, 'lateralEntry', res.lateralEntry, r.lateralEntry);
    }
    return { accuracy: ok / total, ok, total, misses };
  }

  it('education.labelled.jsonl: field accuracy >= 0.90', () => {
    const rows = load('education.labelled.jsonl');
    expect(rows.length).toBeGreaterThanOrEqual(60);
    const s = score(rows);
    expect(s.accuracy, `${s.ok}/${s.total}\n${s.misses.slice(0, 25).join('\n')}`).toBeGreaterThanOrEqual(0.9);
  });

  it('resumes.synthetic.jsonl (full documents): field accuracy >= 0.90', () => {
    const rows = load('resumes.synthetic.jsonl');
    expect(rows.length).toBeGreaterThanOrEqual(40);
    const s = score(rows);
    expect(s.accuracy, `${s.ok}/${s.total}\n${s.misses.slice(0, 25).join('\n')}`).toBeGreaterThanOrEqual(0.9);
  });

  it('every labelled low-confidence entry is detected as low (out-of-range is never silently high)', () => {
    const rows = load('education.labelled.jsonl').filter((r) => r.id.startsWith('edge-'));
    for (const r of rows) {
      const res = run(r.text);
      for (const want of r.education.filter((w) => w.confidence === 'low' && w.score && (w.score.value > w.score.scale))) {
        const got = res.entries.find((e) => e.level === want.level)!;
        expect(got.confidence, r.id).toBe('low');
        expect(got.score?.value, r.id).toBe(want.score!.value);
      }
    }
  });
});

describe('scale', () => {
  it('parses 10k education lines quickly', () => {
    const text = 'Education\n' + 'B.Tech CSE VTU 2022-2026 CGPA 8.5/10\nClass XII CBSE 2022 90%\n'.repeat(5000);
    const t0 = Date.now();
    const r = parseEducation(text);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.entries.length).toBeGreaterThan(0);
    expect(r.entries.length).toBeLessThanOrEqual(5);
  });
});
