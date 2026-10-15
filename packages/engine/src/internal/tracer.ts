/**
 * Evidence construction shared by the engine modules (re-exported from ../trace).
 * Type-only imports keep this file free of runtime cycles.
 */
import type { Evidence, EvidenceSource } from '../trace';

export const QUOTE_MAX = 160;

/** Build evidence from an exact slice of `text`. The quote is truncated to QUOTE_MAX chars with a flag. */
export function evidence(
  source: EvidenceSource,
  text: string,
  start: number,
  end: number,
  extra?: { index?: number; path?: string },
): Evidence {
  const full = text.slice(start, end);
  const e: Evidence = { source, start, end, quote: full.length > QUOTE_MAX ? full.slice(0, QUOTE_MAX) : full };
  if (full.length > QUOTE_MAX) e.quoteTruncated = true;
  if (extra?.index !== undefined) e.index = extra.index;
  if (extra?.path !== undefined) e.path = extra.path;
  return e;
}
