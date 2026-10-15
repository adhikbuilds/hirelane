import { z } from 'zod';
import type { BatchItem } from './types.js';

/**
 * Post-validation for every LLM extractor. The model's answer is a claim about untrusted text, so it is
 * accepted only when it can be checked against that text:
 * - every result id must be one we sent, at most once;
 * - every evidence quote must occur verbatim (whitespace- and case-insensitive) in that item's text.
 * Anything that fails is dropped and reported, never repaired.
 */

/** Bounded building blocks extractor schemas must use, so a model can't return unbounded output. */
export const EVIDENCE_MAX = 300;
export const boundedString = (max = 200) => z.string().min(1).max(max);
export const evidenceQuote = () => z.string().min(3).max(EVIDENCE_MAX);
export const boundedArray = <T extends z.ZodTypeAny>(item: T, max = 50) => z.array(item).max(max);

export interface ExtractedItem {
  id: string;
  evidence: readonly string[];
}

export type RejectReason = 'unknown_id' | 'duplicate_id' | 'evidence_not_in_source' | 'no_evidence';

export interface ValidationResult<T extends ExtractedItem> {
  accepted: T[];
  rejected: { id: string; reason: RejectReason; detail?: string }[];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function validateExtraction<T extends ExtractedItem>(
  sent: readonly BatchItem[],
  results: readonly T[],
  opts: { requireEvidence?: boolean } = {},
): ValidationResult<T> {
  const sources = new Map(sent.map((i) => [i.id, norm(i.text)]));
  const seen = new Set<string>();
  const accepted: T[] = [];
  const rejected: ValidationResult<T>['rejected'] = [];

  for (const r of results) {
    const source = sources.get(r.id);
    if (source === undefined) {
      rejected.push({ id: r.id, reason: 'unknown_id' });
      continue;
    }
    if (seen.has(r.id)) {
      rejected.push({ id: r.id, reason: 'duplicate_id' });
      continue;
    }
    seen.add(r.id);
    if (opts.requireEvidence !== false && r.evidence.length === 0) {
      rejected.push({ id: r.id, reason: 'no_evidence' });
      continue;
    }
    const missing = r.evidence.find((q) => !source.includes(norm(q)));
    if (missing !== undefined) {
      rejected.push({ id: r.id, reason: 'evidence_not_in_source', detail: missing.slice(0, 80) });
      continue;
    }
    accepted.push(r);
  }
  return { accepted, rejected };
}
