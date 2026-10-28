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

export type ExtractResult = (ExtractMeta & { text: string }) | { rejected: RejectCode };
