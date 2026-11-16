import type { ExtractMeta, TextLayer } from './types';

const MIN_CHARS_PER_PAGE = 30;
/** A page with fewer non-space characters than this counts as empty for the 'partial' call. */
const EMPTY_PAGE_CHARS = 10;
const GARBLED_RATIO = 0.3;

/**
 * Judge the text layer of an extracted resume.
 * - 'none': under ~30 non-space characters per page on average.
 * - 'garbled': more than 30% of non-space characters are private-use (U+E000-F8FF) or U+FFFD.
 * - 'partial': some pages are (almost) empty while others have text.
 * - 'readable': otherwise. DOCX (no page count) is judged as one page.
 */
export function assessTextLayer(meta: ExtractMeta, text: string): TextLayer {
  let nonSpace = 0;
  let bad = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x2028 || c === 0x2029 || c === 0x3000 || (c >= 0x2000 && c <= 0x200a) || c === 0xfeff) continue;
    nonSpace++;
    if ((c >= 0xe000 && c <= 0xf8ff) || c === 0xfffd) bad++;
  }
  const pages = Math.max(1, meta.pages ?? 1);
  if (nonSpace / pages < MIN_CHARS_PER_PAGE) return 'none';
  if (bad / nonSpace > GARBLED_RATIO) return 'garbled';
  if (meta.pageStats.some((p) => p.chars < EMPTY_PAGE_CHARS)) return 'partial';
  return 'readable';
}
