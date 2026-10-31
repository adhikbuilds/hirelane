import { describe, expect, it } from 'vitest';
import { legacyText, reconstructText, type PageItems } from '../src/resume/layout';
import { normalizeResumeText } from '../src/resume/sections';
import { parseEducation } from '../src/resume/education';
import { H, W, item, singleColumn, tableResume, twoColumn } from './helpers/layout-items';

const fields = (text: string) =>
  parseEducation(normalizeResumeText(text)).entries.map(({ level, board, score, startYear, passoutYear, degree, branch, confidence }) => ({ level, board, score, startYear, passoutYear, degree, branch, confidence }));

describe('the fixtures are real layouts', () => {
  it('the legacy stream-order text scrambles the two-column page', () => {
    const t = legacyText([twoColumn()]);
    // Interleaved: a skill line sits between the EDUCATION heading and the first degree.
    const edu = t.indexOf('EDUCATION');
    const degree = t.indexOf('B.Tech Computer Science');
    expect(t.slice(edu, degree)).toContain('Python');
  });
});

describe('single column', () => {
  it('stays single column even with right-aligned dates, and keeps legacy order', () => {
    const r = reconstructText([singleColumn()]);
    expect(r.columns).toBe(1);
    expect(r.tables).toBe(0);
    expect(r.text).toBe(legacyText([singleColumn()]));
  });
  it('right-aligned dates are not glued to the text before them', () => {
    const t = reconstructText([singleColumn()]).text;
    expect(t).toMatch(/CGPA: 8\.1\/10 +2022 – 2026|2022 – 2026 +B\.Tech/);
    expect(t).not.toMatch(/8\.1\/102022/);
  });
  it('one item per line (pdf.js with end-of-line flags) is byte-identical to plain concatenation', () => {
    const page: PageItems = { width: W, height: H, items: [{ ...item('Line one', 50, 700), hasEOL: true }, { ...item('Line two', 50, 686), hasEOL: true }] };
    expect(reconstructText([page]).text).toBe('Line one\nLine two\n');
  });
});

describe('two columns', () => {
  const r = reconstructText([twoColumn()]);
  it('is detected', () => {
    expect(r.columns).toBe(2);
  });
  it('reads the left column top to bottom, then the right', () => {
    const t = r.text;
    expect(t.indexOf('SKILLS')).toBeLessThan(t.indexOf('+91 90000 00000'));
    expect(t.indexOf('+91 90000 00000')).toBeLessThan(t.indexOf('EDUCATION'));
    const edu = t.slice(t.indexOf('EDUCATION'), t.indexOf('PROJECTS'));
    expect(edu).not.toContain('Python');
    expect(edu.indexOf('B.Tech')).toBeLessThan(edu.indexOf('Class XII'));
    expect(edu.indexOf('Class XII')).toBeLessThan(edu.indexOf('Class X,'));
  });
  it('the header above the columns comes first', () => {
    expect(r.text.indexOf('Asha Example')).toBe(0);
  });
});

describe('education table', () => {
  const r = reconstructText([tableResume()]);
  it('is detected, with the header row dropped and one line per row', () => {
    expect(r.tables).toBe(1);
    expect(r.text).toContain('B.Tech Computer Science | RGPV | 2022 – 2026 | CGPA: 8.1/10');
    expect(r.text).toContain('Class XII | CBSE | 2022 | 81%');
    expect(r.text).not.toContain('Qualification');
  });
  it('is not a table when only one line has several far-apart pieces', () => {
    const page: PageItems = { width: W, height: H, items: [item('Left', 54, 700), item('Middle', 250, 700), item('Right', 450, 700), item('Next line of text here', 54, 686)] };
    expect(reconstructText([page]).tables).toBe(0);
  });
});

describe('same fields from every layout (RP1 acceptance)', () => {
  const a = fields(reconstructText([singleColumn()]).text);
  const b = fields(reconstructText([twoColumn()]).text);
  const c = fields(reconstructText([tableResume()]).text);
  it('the single-column reference parses all three levels', () => {
    expect(a.map((e) => e.level).sort()).toEqual(['10th', '12th', 'ug']);
    const ug = a.find((e) => e.level === 'ug')!;
    expect(ug).toMatchObject({ board: 'RGPV', startYear: 2022, passoutYear: 2026, score: { kind: 'cgpa', value: 8.1, scale: 10 }, degree: 'btech' });
  });
  it('two-column gives the same fields', () => expect(b).toEqual(a));
  it('table gives the same fields', () => expect(c).toEqual(a));
});

describe('headings by size and weight', () => {
  it('finds large or bold short lines, not body text', () => {
    const r = reconstructText([singleColumn()]);
    const heads = r.headings.map((h) => h.text);
    expect(heads).toEqual(expect.arrayContaining(['EDUCATION', 'SKILLS', 'PROJECTS']));
    expect(heads).not.toContain('Python, SQL, React, Git');
  });
  it('headings are found in a two-column page too', () => {
    expect(reconstructText([twoColumn()]).headings.map((h) => h.text)).toEqual(expect.arrayContaining(['EDUCATION', 'SKILLS']));
  });
});

describe('robustness', () => {
  it('empty and junk input', () => {
    expect(reconstructText([]).text).toBe('');
    expect(reconstructText([{ width: W, height: H, items: [] }]).columns).toBe(1);
    const junk: PageItems = { width: W, height: H, items: [{ str: 'a', x: Number.NaN, y: 1, w: 1, h: 1 }, { str: '', x: 1, y: 1, w: 1, h: 1 }, { str: 'ok', x: 10, y: 10, w: 10, h: 10 }] };
    expect(() => reconstructText([junk])).not.toThrow();
    expect(reconstructText([{ width: 0, height: 0, items: [item('x', 1, 1)] }]).columns).toBe(1);
  });
  it('a big page stays fast', () => {
    const items = Array.from({ length: 6000 }, (_, i) => item(`word${i}`, 40 + (i % 2) * 300, 780 - Math.floor(i / 2) * 0.1));
    const t0 = Date.now();
    reconstructText([{ width: W, height: H, items }]);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('pages are joined by a blank line', () => {
    const r = reconstructText([singleColumn(), singleColumn()]);
    expect(r.text).toContain('\n\n');
  });
});

describe('hostile page sizes and no-loss ordering', () => {
  it('a huge or non-finite page width skips column detection and stays fast', () => {
    const items = twoColumn().items;
    for (const width of [1e9, Number.POSITIVE_INFINITY, Number.NaN, -5, 0, 14401]) {
      const t0 = Date.now();
      const r = reconstructText([{ width, height: H, items }]);
      expect(Date.now() - t0, String(width)).toBeLessThan(500);
      expect(r.columns, String(width)).toBe(1);
      expect(r.text.length).toBeGreaterThan(100);
    }
  });
  it('more than 8000 items on a page are capped, not processed', () => {
    const items = Array.from({ length: 20000 }, (_, i) => item(`w${i}`, 40 + (i % 3) * 150, 780 - Math.floor(i / 3) * 0.05));
    const t0 = Date.now();
    reconstructText([{ width: W, height: H, items }]);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  const allStrs = (p: PageItems) => p.items.map((i) => i.str.trim()).filter(Boolean);
  const noLoss = (p: PageItems, dropped: string[] = []) => {
    const text = reconstructText([p]).text.replace(/\s+/g, ' ');
    for (const s of allStrs(p)) if (!dropped.includes(s)) expect(text, s).toContain(s.replace(/\s+/g, ' '));
  };
  it('every input string appears in the output for every fixture', () => {
    noLoss(singleColumn());
    noLoss(twoColumn());
    // the table's header row is dropped on purpose
    noLoss(tableResume(), ['Qualification', 'Board / University', 'Year', 'Score']);
  });
  it('a piece on the same baseline as a gutter-crossing line is kept', () => {
    const p = twoColumn();
    // A wide line that crosses the gutter, with a short piece on the same baseline in the left column.
    p.items.push(item('A very wide full-width line that crosses the gutter between the two columns of text', 36, 600));
    p.items.push(item('LEFTPIECE', 36, 600));
    p.items.push(item('RIGHTPIECE', 520, 600));
    noLoss(p);
  });
  it('random two-column pages lose nothing', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let n = 0; n < 40; n++) {
      const items = [];
      const rows = 8 + Math.floor(rnd() * 10);
      for (let r = 0; r < rows; r++) {
        const y = 740 - r * 16;
        if (rnd() < 0.8) items.push(item(`L${n}-${r} left text`, 36, y));
        if (rnd() < 0.8) items.push(item(`R${n}-${r} right column text`, 330, y));
        if (rnd() < 0.15) items.push(item(`WIDE${n}-${r} a really wide line that definitely crosses the middle of the page`, 36, y));
      }
      noLoss({ width: W, height: H, items });
    }
  });
});
