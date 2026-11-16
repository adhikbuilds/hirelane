import { describe, expect, it } from 'vitest';
import { assessTextLayer } from '../src/resume/text-layer';
import type { ExtractMeta } from '../src/resume/types';

const meta = (chars: number[], over: Partial<ExtractMeta> = {}): ExtractMeta => ({
  kind: 'pdf',
  pages: chars.length,
  pageStats: chars.map((c) => ({ chars: c, images: 0 })),
  imageCount: 0,
  encrypted: false,
  flags: { javascript: false, embeddedFiles: false, macros: false, externalRefs: false },
  producerFamily: 'test',
  ...over,
});
const words = (n: number) => 'abcdefghi '.repeat(Math.ceil(n / 10)).slice(0, n);

describe('assessTextLayer', () => {
  it('readable for normal text on every page', () => {
    expect(assessTextLayer(meta([400, 300]), words(700))).toBe('readable');
  });
  it('none for empty text', () => {
    expect(assessTextLayer(meta([0]), '')).toBe('none');
    expect(assessTextLayer(meta([0, 0]), '   \n\t ')).toBe('none');
  });
  it('none below ~30 non-space chars per page (boundary 29 vs 30)', () => {
    expect(assessTextLayer(meta([29]), 'a'.repeat(29))).toBe('none');
    expect(assessTextLayer(meta([30]), 'a'.repeat(30))).toBe('readable');
    expect(assessTextLayer(meta([40, 40]), 'a'.repeat(59))).toBe('none');
  });
  it('counts non-space chars only', () => {
    expect(assessTextLayer(meta([100]), 'a b '.repeat(14))).toBe('none'); // 28 non-space
  });
  it('garbled when more than 30% private-use or U+FFFD', () => {
    const pua = ''.repeat(40) + 'a'.repeat(60); // 40%
    expect(assessTextLayer(meta([100]), pua)).toBe('garbled');
    const fffd = '�'.repeat(35) + 'a'.repeat(65);
    expect(assessTextLayer(meta([100]), fffd)).toBe('garbled');
    const edge = ''.repeat(30) + 'a'.repeat(70); // exactly 30%: not more than
    expect(assessTextLayer(meta([100]), edge)).toBe('readable');
  });
  it('partial when some pages are empty but text exists', () => {
    expect(assessTextLayer(meta([500, 0, 400]), words(900))).toBe('partial');
  });
  it('DOCX (pages null, no pageStats) is judged as one page', () => {
    const docx = meta([], { kind: 'docx', pages: null });
    expect(assessTextLayer(docx, words(200))).toBe('readable');
    expect(assessTextLayer(docx, 'short')).toBe('none');
  });
  it('is robust to odd meta (zero pages)', () => {
    expect(assessTextLayer(meta([], { pages: 0 }), words(100))).toBe('readable');
  });
  it('none beats garbled when there is almost nothing', () => {
    expect(assessTextLayer(meta([10]), ''.repeat(10))).toBe('none');
  });
});
