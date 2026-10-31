import { parseEducation, normalizeResumeText } from '@hirelane/engine';
import { describe, expect, it } from 'vitest';
import { extractResume } from '../src/resume/extract/index';
import { extractResumeLaidOut } from '../src/resume/extract/laid-out';
import { extractInThread } from '../src/resume/extract/thread';
import type { ExtractResult } from '../src/resume/extract/types';
import { applyLayout, sanitizePages } from '../src/resume/extract/layout';
import { hugeMediaBoxPdf, singleColumnPdf, tablePdf, twoColumnPdf } from './fixtures/layout-pdfs';

function ok(r: ExtractResult) {
  if ('rejected' in r) throw new Error(`rejected ${r.rejected}`);
  return r;
}
const fields = (text: string) =>
  JSON.stringify(parseEducation(normalizeResumeText(text)).entries.map(({ level, board, score, startYear, passoutYear, degree, branch, confidence }) => ({ level, board, score, startYear, passoutYear, degree, branch, confidence })));

describe('layout-aware PDF text (RP1)', () => {
  it('RED proof: plain stream-order text of the two-column PDF is scrambled', async () => {
    const plain = ok(await extractResume(twoColumnPdf())).text;
    const edu = plain.indexOf('EDUCATION');
    expect(plain.slice(edu, plain.indexOf('B.Tech', edu))).toContain('Python');
  });

  it('single column with right-aligned dates stays one column and reads in order', async () => {
    const r = ok(await extractResumeLaidOut(singleColumnPdf()));
    expect(r.layout?.columns).toBe(1);
    expect(r.layout?.tables).toBe(0);
    expect(r.layoutPages).toBeUndefined();
    expect(r.text).toContain('B.Tech Computer Science, RGPV, CGPA: 8.1/10');
    expect(r.text).not.toMatch(/8\.1\/102022/);
  });

  it('two-column PDF is read left then right', async () => {
    const r = ok(await extractResumeLaidOut(twoColumnPdf()));
    expect(r.layout?.columns).toBe(2);
    const edu = r.text.slice(r.text.indexOf('EDUCATION'), r.text.indexOf('PROJECTS'));
    expect(edu).not.toContain('Python');
    expect(edu.indexOf('B.Tech')).toBeLessThan(edu.indexOf('Class XII'));
  });

  it('table PDF becomes one line per row', async () => {
    const r = ok(await extractResumeLaidOut(tablePdf()));
    expect(r.layout?.tables).toBe(1);
    expect(r.text).toContain('Class XII | CBSE | 2022 | 81%');
  });

  it('headings by size and weight come through from real font objects', async () => {
    const r = ok(await extractResumeLaidOut(singleColumnPdf()));
    expect(r.layout?.headingCount).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(r.layout)).not.toContain('EDUCATION');
  });

  it('all three PDFs parse into the same education fields', async () => {
    const a = fields(ok(await extractResumeLaidOut(singleColumnPdf())).text);
    expect(JSON.parse(a).map((e: { level: string }) => e.level).sort()).toEqual(['10th', '12th', 'ug']);
    expect(fields(ok(await extractResumeLaidOut(twoColumnPdf())).text)).toBe(a);
    expect(fields(ok(await extractResumeLaidOut(tablePdf())).text)).toBe(a);
  });

  it('works through the sandboxed child: reading order is rebuilt in the parent', async () => {
    const r = ok(await extractInThread(twoColumnPdf()));
    expect(r.layout?.columns).toBe(2);
    expect(r.layoutPages).toBeUndefined();
    expect(r.text.indexOf('SKILLS')).toBeLessThan(r.text.indexOf('EDUCATION'));
  });

  it('page stats still count characters of the page', async () => {
    const r = ok(await extractResumeLaidOut(twoColumnPdf()));
    expect(r.pageStats[0]!.chars).toBeGreaterThan(300);
  });
});

describe('hostile input to the layout pass', () => {
  it('a PDF with a 200-million-point MediaBox returns quickly, as plain readable text', async () => {
    const t0 = Date.now();
    const r = ok(await extractResumeLaidOut(hugeMediaBoxPdf()));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.layout?.columns).toBe(1);
    expect(r.text).toContain('Asha Example');
  });
  it('applyLayout drops malformed layoutPages and keeps the plain text', () => {
    const base = { kind: 'pdf' as const, pages: 1, pageStats: [], imageCount: 0, encrypted: false, flags: { javascript: false, embeddedFiles: false, macros: false, externalRefs: false }, producerFamily: 'x', text: 'plain text' };
    for (const bad of [{}, 'x', null, [], [1], new Array(4).fill({ width: 600, height: 800, items: [] }), [{ width: 600, height: 800, items: new Array(8001).fill(0) }]]) {
      const r = applyLayout({ ...base, pageStats: [], layoutPages: bad as never });
      expect('rejected' in r ? '' : r.text).toBe('plain text');
      expect('layoutPages' in r).toBe(false);
    }
  });
  it('sanitizePages clamps odd numbers and long strings', () => {
    const p = sanitizePages([{ width: 1e12, height: Number.NaN, items: [{ str: 'x'.repeat(5000), x: 1, y: 2, w: -3, h: 4, fontSize: 1e9 }, { str: 5, x: 1, y: 1, w: 1, h: 1 }, { str: 'ok', x: Number.NaN, y: 1, w: 1, h: 1 }] }])!;
    expect(p[0]!.width).toBe(0);
    expect(p[0]!.height).toBe(0);
    expect(p[0]!.items).toHaveLength(1);
    expect(p[0]!.items[0]!.str.length).toBe(500);
    expect(p[0]!.items[0]!.w).toBe(0);
    expect(p[0]!.items[0]!.fontSize).toBeUndefined();
  });
});
