/** Synthetic positioned text items for the layout tests. PDF coordinates: y grows upward. Page 612 x 792. */
import type { PageItems, TextItem } from '../../src/resume/layout';

export const W = 612;
export const H = 792;
const cw = (size: number) => size * 0.5;

/** Marks the last item of each visual line, the way pdf.js does. */
export function eol(items: TextItem[]): TextItem[] {
  return items.map((it, i) => {
    const next = items[i + 1];
    return !next || Math.abs(next.y - it.y) > 0.5 * (it.fontSize ?? 10) ? { ...it, hasEOL: true } : it;
  });
}

export function item(str: string, x: number, y: number, size = 11, bold = false): TextItem {
  return { str, x, y, w: str.length * cw(size), h: size, fontSize: size, bold };
}

export interface EduRow {
  left: string;
  right: string;
  cells: string[];
}

/** One student's three education rows, written for each layout. */
export function eduSet(degree: string, univ: string, from: number, cgpa: string, board: string, p12: number, p10: number): EduRow[] {
  const yrs = `${from} – ${from + 4}`;
  return [
    { left: `${degree}, ${univ}, CGPA: ${cgpa}/10`, right: yrs, cells: [degree, univ, yrs, `CGPA: ${cgpa}/10`] },
    { left: `Class XII, ${board}, ${p12}%`, right: String(from), cells: ['Class XII', board, String(from), `${p12}%`] },
    { left: `Class X, ${board}, ${p10}%`, right: String(from - 2), cells: ['Class X', board, String(from - 2), `${p10}%`] },
  ];
}

/** Entries every variant carries. */
export const EDU: EduRow[] = eduSet('B.Tech Computer Science', 'RGPV', 2022, '8.1', 'CBSE', 81, 88);
const SKILLS = ['Python, SQL, React, Git', 'Data structures and algorithms', 'REST APIs, unit testing', 'Excel, Tally, GST basics'];
const BULLETS = [
  'Built a library tracker with REST API and tests, used by 120 students across two hostels in the first month.',
  'Cut report preparation time by 40 percent by automating a weekly spreadsheet export for the placement cell.',
  'Led a team of four to ship a campus bus tracker, handling routing, notifications and the admin dashboard.',
];

/** A: single column. Dates are separate right-aligned items on the same line. Long bullet lines span the page. */
export function singleColumn(edu: EduRow[] = EDU): PageItems {
  const items: TextItem[] = [];
  let y = 740;
  const line = (s: string, size = 11, bold = false, x = 54) => {
    items.push(item(s, x, y, size, bold));
    y -= size + 4;
  };
  line('Asha Example', 18, true);
  line('asha.example@example.invalid | +91 90000 00000');
  y -= 6;
  line('EDUCATION', 13, true);
  for (const e of edu) {
    items.push(item(e.right, 500 - e.right.length * cw(11) + 40, y));
    items.push(item(e.left, 54, y));
    y -= 15;
  }
  y -= 6;
  line('SKILLS', 13, true);
  for (const s of SKILLS) line(s);
  y -= 6;
  line('PROJECTS', 13, true);
  for (const b of BULLETS) line(b);
  return { width: W, height: H, items: eol(items) };
}

/** B: two columns, left sidebar (skills) and right main column (education, projects), interleaved row by row like a design tool does. */
export function twoColumn(edu: EduRow[] = EDU): PageItems {
  const items: TextItem[] = [];
  const LX = 36;
  const RX = 230;
  items.push(item('Asha Example', LX, 750, 18, true));
  const left: [string, number, boolean][] = [['SKILLS', 13, true], ...SKILLS.map((s): [string, number, boolean] => [s, 11, false]), ['LINKS', 13, true], ['github.com/asha-test', 11, false], ['CONTACT', 13, true], ['asha.example@example.invalid', 11, false], ['+91 90000 00000', 11, false]];
  const right: [string, number, boolean][] = [['EDUCATION', 13, true]];
  for (const e of edu) right.push([e.left, 11, false], [e.right, 11, false]);
  right.push(['PROJECTS', 13, true], ...BULLETS.flatMap((b): [string, number, boolean][] => wrap(b, 52).map((s) => [s, 11, false] as [string, number, boolean])));
  const n = Math.max(left.length, right.length);
  let y = 715;
  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    if (l) items.push(item(l[0], LX, y, l[1], l[2]));
    if (r) items.push(item(r[0], RX, y, r[1], r[2]));
    y -= 17;
  }
  return { width: W, height: H, items: eol(items) };
}

function wrap(s: string, n: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if ((cur + ' ' + w).trim().length > n) {
      out.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

/** C: single column with an education table (header row plus one row per entry, four columns). */
export function tableResume(edu: EduRow[] = EDU): PageItems {
  const items: TextItem[] = [];
  let y = 740;
  const line = (s: string, size = 11, bold = false) => {
    items.push(item(s, 54, y, size, bold));
    y -= size + 4;
  };
  line('Asha Example', 18, true);
  line('asha.example@example.invalid | +91 90000 00000');
  y -= 6;
  line('EDUCATION', 13, true);
  const xs = [40, 260, 370, 470];
  const row = (cells: string[], bold = false) => {
    cells.forEach((c, i) => items.push(item(c, xs[i]!, y, 11, bold)));
    y -= 18;
  };
  row(['Qualification', 'Board / University', 'Year', 'Score'], true);
  for (const e of edu) row(e.cells);
  y -= 6;
  line('SKILLS', 13, true);
  for (const s of SKILLS) line(s);
  y -= 6;
  line('PROJECTS', 13, true);
  for (const b of BULLETS) line(b);
  return { width: W, height: H, items: eol(items) };
}
