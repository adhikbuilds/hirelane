/** Extractor contract (Slice 1, Amendment B section 2). Type-only. */
import type { ExtractMeta } from '@hirelane/engine';

export type RejectCode =
  | 'too_large'
  | 'bad_magic'
  | 'encrypted'
  | 'too_many_pages'
  | 'zip_guard'
  | 'macro'
  | 'active_content'
  | 'doctype'
  | 'parse_error'
  | 'timeout';

/** A positioned text piece from pdf.js. y grows upward. */
export interface LayoutItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  bold: boolean;
  hasEOL: boolean;
}
export interface LayoutPage {
  width: number;
  height: number;
  items: LayoutItem[];
}

/** How the PDF was read: two columns, education tables turned into rows, heading lines by size and weight. */
export interface LayoutMeta {
  columns: 1 | 2;
  tables: number;
  /** A count only. Heading text is resume content and stays out of result metadata. */
  headingCount: number;
}

export type ExtractResult = (ExtractMeta & { text: string; layout?: LayoutMeta; layoutPages?: LayoutPage[] }) | { rejected: RejectCode };
