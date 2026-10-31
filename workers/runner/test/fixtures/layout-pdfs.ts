/**
 * Positioned-text PDFs for the layout tests. Synthetic only. Each piece of text is its own BT/ET block at an exact
 * position, in the order a design tool writes them (row by row across columns), which is what breaks plain concatenation.
 */
import { buildPdf, pdfEsc, stream } from './generate-resume-fixtures';

interface Piece {
  s: string;
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
}

function pdf(pieces: Piece[], mediaBox = '0 0 612 792'): Uint8Array {
  let content = '';
  for (const p of pieces) content += `BT /${p.bold ? 'F2' : 'F1'} ${p.size ?? 11} Tf 1 0 0 1 ${p.x} ${p.y} Tm (${pdfEsc(p.s)}) Tj ET\n`;
  return buildPdf({
    objects: [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Contents 6 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`,
      stream('', content),
    ],
    root: 1,
  });
}

export const EDU = [
  { left: 'B.Tech Computer Science, RGPV, CGPA: 8.1/10', right: '2022 - 2026', cells: ['B.Tech Computer Science', 'RGPV', '2022 - 2026', 'CGPA: 8.1/10'] },
  { left: 'Class XII, CBSE, 81%', right: '2022', cells: ['Class XII', 'CBSE', '2022', '81%'] },
  { left: 'Class X, CBSE, 88%', right: '2020', cells: ['Class X', 'CBSE', '2020', '88%'] },
];
const SKILLS = ['Python, SQL, React, Git', 'Data structures and algorithms', 'REST APIs, unit testing', 'Excel, Tally, GST basics'];
const BULLETS = [
  'Built a library tracker with REST API and tests, used by 120 students across two hostels in the first month.',
  'Cut report preparation time by 40 percent by automating a weekly spreadsheet export for the placement cell.',
  'Led a team of four to ship a campus bus tracker, handling routing, notifications and the admin dashboard.',
];
const wrap = (s: string, n: number): string[] => {
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
};

/** Single column; dates are separate right-aligned pieces; bullets run the full width. */
export function singleColumnPdf(): Uint8Array {
  const p: Piece[] = [];
  let y = 740;
  const line = (s: string, size = 11, bold = false) => {
    p.push({ s, x: 54, y, size, bold });
    y -= size + 4;
  };
  line('Asha Example', 18, true);
  line('asha.example@example.invalid | +91 90000 00000');
  y -= 6;
  line('EDUCATION', 13, true);
  for (const e of EDU) {
    p.push({ s: e.left, x: 54, y });
    p.push({ s: e.right, x: 500, y });
    y -= 15;
  }
  y -= 6;
  line('SKILLS', 13, true);
  SKILLS.forEach((s) => line(s));
  y -= 6;
  line('PROJECTS', 13, true);
  BULLETS.forEach((s) => line(s));
  return pdf(p);
}

/** Two columns written row by row: sidebar on the left, main column on the right. */
export function twoColumnPdf(): Uint8Array {
  const p: Piece[] = [{ s: 'Asha Example', x: 36, y: 750, size: 18, bold: true }];
  const left: Piece[] = [
    { s: 'SKILLS', x: 36, y: 0, size: 13, bold: true },
    ...SKILLS.map((s) => ({ s, x: 36, y: 0 })),
    { s: 'LINKS', x: 36, y: 0, size: 13, bold: true },
    { s: 'github.com/asha-test', x: 36, y: 0 },
    { s: 'CONTACT', x: 36, y: 0, size: 13, bold: true },
    { s: 'asha.example@example.invalid', x: 36, y: 0 },
    { s: '+91 90000 00000', x: 36, y: 0 },
  ];
  const right: Piece[] = [{ s: 'EDUCATION', x: 230, y: 0, size: 13, bold: true }];
  for (const e of EDU) right.push({ s: e.left, x: 230, y: 0 }, { s: e.right, x: 230, y: 0 });
  right.push({ s: 'PROJECTS', x: 230, y: 0, size: 13, bold: true }, ...BULLETS.flatMap((b) => wrap(b, 52).map((s) => ({ s, x: 230, y: 0 }))));
  let y = 715;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i]) p.push({ ...left[i]!, y });
    if (right[i]) p.push({ ...right[i]!, y });
    y -= 17;
  }
  return pdf(p);
}

/** Single column with an education table. */
export function tablePdf(): Uint8Array {
  const p: Piece[] = [];
  let y = 740;
  const line = (s: string, size = 11, bold = false) => {
    p.push({ s, x: 54, y, size, bold });
    y -= size + 4;
  };
  line('Asha Example', 18, true);
  line('asha.example@example.invalid | +91 90000 00000');
  y -= 6;
  line('EDUCATION', 13, true);
  const xs = [40, 260, 370, 470];
  const row = (cells: string[], bold = false) => {
    cells.forEach((c, i) => p.push({ s: c, x: xs[i]!, y, bold }));
    y -= 18;
  };
  row(['Qualification', 'Board / University', 'Year', 'Score'], true);
  EDU.forEach((e) => row(e.cells));
  y -= 6;
  line('SKILLS', 13, true);
  SKILLS.forEach((s) => line(s));
  y -= 6;
  line('PROJECTS', 13, true);
  BULLETS.forEach((s) => line(s));
  return pdf(p);
}

/** Twelve or more text pieces on a page whose MediaBox is 200 million points wide. */
export function hugeMediaBoxPdf(): Uint8Array {
  const p: Piece[] = [{ s: 'Asha Example', x: 54, y: 740, size: 18, bold: true }];
  for (let i = 0; i < 16; i++) p.push({ s: `Line ${i} of ordinary resume text`, x: 54, y: 700 - i * 15 });
  return pdf(p, '0 0 200000000 200000000');
}
