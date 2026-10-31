/**
 * Parent-side layout pass (PRD RP1). The sandboxed extraction child cannot load the engine, so it returns
 * plain stream-order text plus the positioned items; this turns them into reading-order text.
 * The child's message is checked before use (it is our code, but it has just read a hostile file): at most
 * MAX_PDF_PAGES pages, MAX_ITEMS items per page, finite numbers, short strings. Never throws: on any problem
 * the plain text is kept.
 */
import { MAX_ITEMS_PER_PAGE, MAX_PAGE_WIDTH, reconstructText, type PageItems, type TextItem } from '@hirelane/engine';
import { MAX_TEXT_CHARS } from './limits';
import type { ExtractResult } from './types';

const MAX_PAGES = 3;
const MAX_STR = 500;
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Rebuilds clean page objects from untrusted input. Returns null when the shape is wrong. */
export function sanitizePages(input: unknown): PageItems[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_PAGES) return null;
  const pages: PageItems[] = [];
  for (const raw of input as unknown[]) {
    const p = raw as { width?: unknown; height?: unknown; items?: unknown } | null;
    if (!p || !Array.isArray(p.items) || p.items.length > MAX_ITEMS_PER_PAGE) return null;
    const width = fin(p.width) && p.width > 0 && p.width <= MAX_PAGE_WIDTH ? p.width : 0;
    const height = fin(p.height) && p.height > 0 && p.height <= MAX_PAGE_WIDTH ? p.height : 0;
    const items: TextItem[] = [];
    for (const r of p.items as unknown[]) {
      const it = r as Record<string, unknown> | null;
      if (!it || typeof it.str !== 'string' || !fin(it.x) || !fin(it.y) || !fin(it.w) || !fin(it.h)) continue;
      items.push({
        str: it.str.length > MAX_STR ? it.str.slice(0, MAX_STR) : it.str,
        x: it.x,
        y: it.y,
        w: Math.max(0, it.w),
        h: Math.max(0, it.h),
        fontSize: fin(it.fontSize) && it.fontSize > 0 && it.fontSize < 1000 ? it.fontSize : undefined,
        bold: it.bold === true,
        hasEOL: it.hasEOL === true,
      });
    }
    pages.push({ width, height, items });
  }
  return pages;
}

export function applyLayout(r: ExtractResult): ExtractResult {
  if ('rejected' in r) return r;
  const { layoutPages, ...rest } = r;
  if (layoutPages === undefined) return rest;
  try {
    const pages = sanitizePages(layoutPages);
    if (!pages) return rest;
    const laid = reconstructText(pages);
    if (laid.text.replace(/\s+/g, '').length === 0) return rest;
    const text = laid.text.length > MAX_TEXT_CHARS ? laid.text.slice(0, MAX_TEXT_CHARS) : laid.text;
    return { ...rest, text, layout: { columns: laid.columns, tables: laid.tables, headingCount: laid.headings.length } };
  } catch {
    return rest;
  }
}
