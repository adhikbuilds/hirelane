/**
 * Layout-aware PDF text (PRD RP1). Pure: works on plain positioned items (the runner maps pdf.js text items into
 * them), so the engine never imports a PDF library.
 *
 * PDF coordinates: y grows upward. Item order is the order of the content stream.
 *
 * What it does:
 *  - Two-column pages (Canva and design-tool resumes) are found from a vertical gutter that almost no item crosses,
 *    and read left column then right column, with full-width lines (a header) in place.
 *  - Education tables are found from 3+ consecutive lines whose pieces line up in 3+ columns, and each row becomes
 *    one "cell | cell | cell" line, with the header row dropped.
 *  - Headings are found by size and weight as well as by words.
 *  - Anything else keeps the legacy stream-order text, with a space added where two pieces on one line do not touch
 *    (right-aligned dates were being glued to the text before them). One-item-per-line pages are byte-identical.
 */

export interface TextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  bold?: boolean;
  /** pdf.js end-of-line flag. */
  hasEOL?: boolean;
}
export interface PageItems {
  width: number;
  height: number;
  items: TextItem[];
}
export interface Heading {
  text: string;
  page: number;
}
export interface LayoutResult {
  text: string;
  /** 2 when any page was read as two columns. */
  columns: 1 | 2;
  /** Number of education-style tables turned into rows. */
  tables: number;
  /** Heading candidates by size or weight, in reading order. */
  headings: Heading[];
}

/** Largest page width (points) column detection will scan. */
export const MAX_PAGE_WIDTH = 14400;
/** Most items read per page; the rest are ignored. */
export const MAX_ITEMS_PER_PAGE = 8000;

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const fsOf = (it: TextItem): number => (fin(it.fontSize) && it.fontSize > 0 ? it.fontSize : fin(it.h) && it.h > 0 ? it.h : 10);
const valid = (it: TextItem): boolean => !!it && typeof it.str === 'string' && it.str.trim() !== '' && fin(it.x) && fin(it.y) && fin(it.w) && it.w >= 0;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

// ---------------------------------------------------------------------------------------------
// Legacy text
// ---------------------------------------------------------------------------------------------

function pageLegacy(items: TextItem[]): string {
  let text = '';
  let prev: TextItem | null = null;
  let prevEol = true;
  for (const it of items) {
    if (!it || typeof it.str !== 'string') continue;
    const s = it.str.replace(/\u0000/g, '');
    if (prev && !prevEol && fin(it.x) && fin(prev.x) && fin(prev.w) && fin(it.y) && fin(prev.y)) {
      const fs = fsOf(it);
      const sameLine = Math.abs(it.y - prev.y) <= 0.5 * fs;
      const gap = it.x - (prev.x + prev.w);
      if (sameLine && (gap > 0.2 * fs || gap < -0.5 * fs) && !/\s$/.test(text) && !/^\s/.test(s) && s !== '') text += ' ';
    }
    text += s;
    if (it.hasEOL) text += '\n';
    prev = it;
    prevEol = !!it.hasEOL;
  }
  return text;
}

/** Stream-order text, as before, plus a space between pieces of one line that do not touch. */
export function legacyText(pages: readonly PageItems[]): string {
  return pages.map((p) => pageLegacy(p?.items ?? [])).join('\n\n');
}

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

interface Line {
  y: number;
  items: TextItem[];
}

function toLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    const tol = Math.max(1.5, 0.45 * fsOf(it));
    if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** Splits a line into cells at gaps wider than `gapFs` font sizes. */
function cellsOf(line: Line, gapFs: number): { x: number; text: string }[] {
  const cells: { x: number; text: string; end: number }[] = [];
  for (const it of line.items) {
    const last = cells[cells.length - 1];
    const fs = fsOf(it);
    if (last && it.x - last.end <= gapFs * fs) {
      const glue = it.x - last.end > 0.15 * fs && !/\s$/.test(last.text) ? ' ' : '';
      last.text += glue + it.str.trim();
      last.end = it.x + it.w;
    } else cells.push({ x: it.x, text: it.str.trim(), end: it.x + it.w });
  }
  return cells;
}

const lineText = (l: Line): string => cellsOf(l, 1e9).map((c) => c.text).join('');

// ---------------------------------------------------------------------------------------------
// Two columns
// ---------------------------------------------------------------------------------------------

interface Split {
  left: TextItem[];
  right: TextItem[];
  spanning: TextItem[];
}

function findColumns(items: TextItem[], width: number): Split | null {
  // 14400 is the PDF page-size limit. A hostile MediaBox must not size the scan below.
  if (!fin(width) || width <= 0 || width > MAX_PAGE_WIDTH || items.length < 12) return null;
  const lo = Math.floor(width * 0.25);
  const hi = Math.ceil(width * 0.75);
  const diff = new Int32Array(hi - lo + 2);
  for (const it of items) {
    const a = Math.max(lo, Math.floor(it.x) + 1);
    const b = Math.min(hi, Math.ceil(it.x + it.w) - 1);
    if (b < a) continue;
    diff[a - lo]! += 1;
    diff[b - lo + 1]! -= 1;
  }
  const cross: number[] = [];
  let acc = 0;
  for (let g = lo; g <= hi; g++) {
    acc += diff[g - lo]!;
    cross.push(acc);
  }
  const maxCross = Math.max(1, Math.floor(items.length * 0.12));
  const minGutter = Math.max(8, width * 0.015);
  /** Longest stretch where `ok` holds, as [from, to] indexes into `cross`. */
  const longest = (ok: (v: number) => boolean, a = 0, b = cross.length - 1): [number, number] | null => {
    let best: [number, number] | null = null;
    let from = -1;
    for (let i = a; i <= b; i++) {
      if (ok(cross[i]!)) {
        if (from < 0) from = i;
        if (!best || i - from > best[1] - best[0]) best = [from, i];
      } else from = -1;
    }
    return best;
  };
  // A clean gutter (nothing crosses) wins. Otherwise allow a few full-width lines (a header) and sit on the emptiest part.
  let span = longest((v) => v === 0);
  if (!span || span[1] - span[0] < minGutter) {
    const loose = longest((v) => v <= maxCross);
    if (!loose) return null;
    let m = Infinity;
    for (let i = loose[0]; i <= loose[1]; i++) if (cross[i]! < m) m = cross[i]!;
    span = longest((v) => v === m, loose[0], loose[1]);
    if (!span || loose[1] - loose[0] < minGutter) return null;
  }
  const g = lo + (span[0] + span[1]) / 2;
  const left: TextItem[] = [];
  const right: TextItem[] = [];
  const spanning: TextItem[] = [];
  for (const it of items) {
    if (it.x + it.w <= g) left.push(it);
    else if (it.x >= g) right.push(it);
    else spanning.push(it);
  }
  const ll = toLines(left);
  const rl = toLines(right);
  if (ll.length < 5 || rl.length < 5) return null;
  // A real column is dense. Right-aligned dates are not: they are spread out between other content.
  const heights = items.map(fsOf);
  const lh = Math.max(4, median(heights) * 1.2);
  const gaps: number[] = [];
  for (let i = 1; i < rl.length; i++) gaps.push(rl[i - 1]!.y - rl[i]!.y);
  if (median(gaps) > 2.5 * lh) return null;
  return { left, right, spanning };
}

function columnLines(split: Split): Line[] {
  const spanLines = toLines(split.spanning);
  // A column piece on the same baseline as a full-width line belongs to that line, so no piece falls between regions.
  const left: TextItem[] = [];
  const right: TextItem[] = [];
  const place = (items: TextItem[], into: TextItem[]) => {
    for (const it of items) {
      const tol = Math.max(1.5, 0.45 * fsOf(it));
      const host = spanLines.find((l) => Math.abs(l.y - it.y) <= tol);
      if (host) host.items.push(it);
      else into.push(it);
    }
  };
  place(split.left, left);
  place(split.right, right);
  for (const l of spanLines) l.items.sort((a, b) => a.x - b.x);
  const out: Line[] = [];
  const edges = [Infinity, ...spanLines.map((l) => l.y), -Infinity];
  for (let k = 0; k < edges.length - 1; k++) {
    const top = edges[k]!;
    const bottom = edges[k + 1]!;
    if (k > 0) out.push(spanLines[k - 1]!);
    const inRegion = (it: TextItem) => it.y < top && it.y > bottom;
    out.push(...toLines(left.filter(inRegion)), ...toLines(right.filter(inRegion)));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------------

const TABLE_GAP_FS = 1.5;
const HEADER_WORD = /qualification|degree|course|exam|level|board|universit|institut|school|college|year|percent|cgpa|marks|score|result|grade|class|stream|branch/i;

interface Row {
  cells: { x: number; text: string }[];
}

function aligned(a: Row, cols: number[]): boolean {
  if (a.cells.length < 3 || a.cells.length > 8) return false;
  let hit = 0;
  for (const c of a.cells) if (cols.some((x) => Math.abs(x - c.x) <= 4)) hit++;
  return hit >= 3 && hit >= a.cells.length - 1;
}

function isHeaderRow(r: Row): boolean {
  const t = r.cells.map((c) => c.text);
  return t.every((x) => !/\d/.test(x)) && t.filter((x) => HEADER_WORD.test(x)).length >= 2;
}

/** Turns table runs into "a | b | c" lines. Returns the lines of text and the number of tables found. */
function renderLines(lines: Line[]): { texts: string[]; tables: number; isRow: boolean[] } {
  const rows: (Row | null)[] = lines.map((l) => {
    const cells = cellsOf(l, TABLE_GAP_FS);
    return cells.length >= 3 ? { cells } : null;
  });
  const texts: string[] = [];
  const isRow: boolean[] = [];
  let tables = 0;
  let i = 0;
  while (i < lines.length) {
    const r = rows[i];
    if (r) {
      // Grow a run of lines that line up with this one.
      const cols = r.cells.map((c) => c.x);
      let j = i + 1;
      while (j < lines.length && rows[j] && aligned(rows[j]!, cols)) j++;
      if (j - i >= 3 && aligned(r, cols)) {
        tables++;
        const run = rows.slice(i, j) as Row[];
        const start = isHeaderRow(run[0]!) ? 1 : 0;
        for (let k = start; k < run.length; k++) {
          texts.push(run[k]!.cells.map((c) => c.text).join(' | '));
          isRow.push(true);
        }
        i = j;
        continue;
      }
    }
    texts.push(cellsOf(lines[i]!, 1e9).map((c) => c.text).join(' ').replace(/\s+/g, ' '));
    isRow.push(false);
    i++;
  }
  return { texts, tables, isRow };
}

// ---------------------------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------------------------

function headingsOf(lines: Line[], body: number, page: number): Heading[] {
  const out: Heading[] = [];
  for (const l of lines) {
    const t = lineText(l).replace(/\s+/g, ' ').trim();
    if (t.length < 2 || t.length > 40 || !/\p{L}/u.test(t)) continue;
    if (cellsOf(l, TABLE_GAP_FS).length >= 3) continue;
    const big = l.items.every((it) => fsOf(it) >= body * 1.15);
    const bold = l.items.every((it) => it.bold === true);
    if (big || bold) out.push({ text: t, page });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------------------------

export function reconstructText(pages: readonly PageItems[]): LayoutResult {
  const texts: string[] = [];
  const headings: Heading[] = [];
  let columns: 1 | 2 = 1;
  let tables = 0;
  (pages ?? []).forEach((p, pi) => {
    const raw = Array.isArray(p?.items) ? p.items.slice(0, MAX_ITEMS_PER_PAGE) : [];
    const all = raw.filter(valid);
    const body = median(all.map(fsOf)) || 10;
    const split = findColumns(all, p?.width ?? 0);
    const lines = split ? columnLines(split) : toLines(all);
    headings.push(...headingsOf(lines, body, pi));
    if (split) {
      columns = 2;
      texts.push(renderLines(lines.map((l) => l)).texts.join('\n'));
      return;
    }
    const r = renderLines(lines);
    if (r.tables > 0) {
      tables += r.tables;
      texts.push(r.texts.join('\n'));
    } else texts.push(pageLegacy(raw));
  });
  return { text: texts.join('\n\n').replace(/\u0000/g, ''), columns, tables, headings };
}
