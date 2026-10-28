/**
 * Resume extraction pipeline (S3.5): bytes in, a decision out. No DB, no vault, no network, 0 LLM calls.
 *
 *   extract (child process) -> reject / needs_text / parsed
 *
 * Order matters on the parsed path:
 *   1. normalise, 2. detect sensitive kinds, 3. MASK Aadhaar / VID / PAN (length preserving),
 *   4. sections + education on the masked text, 5. health on the UNMASKED text (in memory only), because
 *      `no_biodata_ids` re-detects and a masked number would wrongly pass.
 * Only the masked text goes into the document that the caller seals. Nothing here logs.
 */
import {
  assessHealth,
  detectSections,
  detectSensitive,
  maskSensitive,
  normalizeResumeText,
  parseEducation,
  type EducationParse,
  type ExtractMeta,
  type HealthReport,
} from '@hirelane/engine';

type HealthCheck = HealthReport['checks'][number];
type TextLayer = HealthReport['textLayer'];
type EducationEntry = EducationParse['entries'][number];
type Backlogs = EducationParse['backlogs'];
type ResumeSection = ReturnType<typeof detectSections>[number];
type SensitiveKind = ReturnType<typeof detectSensitive>[number]['kind'];
import { extractInThread } from './extract/thread';
import type { ExtractResult, RejectCode } from './extract/types';

export const PARSED_DOC_VERSION = 1;

/** What is sealed into `resumes.parsed_enc` once parsing succeeds. Text is already masked. */
export interface ParsedResumeDoc {
  v: typeof PARSED_DOC_VERSION;
  /** Original upload file name (lives only here). */
  fileName: string | null;
  text: string;
  sections: ResumeSection[];
  education: EducationEntry[];
  backlogs: Backlogs;
  lateralEntry: boolean;
  /** Guided-builder answers, carried over from the draft so the student can edit and re-render. */
  builder?: unknown;
}

interface Common {
  pages: number | null;
  textLayer: TextLayer;
  producerFamily: string;
  health: HealthCheck[];
  healthPassed: number;
  healthTotal: 9;
  sensitiveKinds: SensitiveKind[];
}

export type PipelineOutcome =
  | { kind: 'rejected'; status: 'rejected'; rejectCode: RejectCode; pages: null }
  | ({ kind: 'needs_text'; status: 'needs_text' } & Common)
  | ({ kind: 'parsed'; status: 'parsed'; doc: ParsedResumeDoc } & Common);

export interface PipelineOptions {
  /** Original file name, inspected for health and sensitive kinds, never echoed. */
  fileName?: string | null;
  /** Replaceable for tests; defaults to the resource-limited child process. */
  extract?: (bytes: Uint8Array) => Promise<ExtractResult>;
}

/** `producer_family` must fit ^[a-z_]{1,24}$. */
export function sanitizeProducerFamily(v: unknown): string {
  const s = String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
    .replace(/_+$/g, '');
  return s || 'unknown';
}

/** Caps the services schema (packages/services/src/parsed.ts) enforces on read; a doc over them would be an unreadable record. */
const MAX_DOC_TEXT = 200_000;
const MAX_SECTIONS = 300;
const MAX_EDUCATION = 8;
const MAX_EVIDENCE = 10;
const MAX_FILE_NAME = 255;

function maskFileName(name: string): string {
  const normalised = normalizeResumeText(name);
  // normalizeResumeText can change length and the masker is length preserving, so mask the normalised copy.
  return maskSensitive(normalised, detectSensitive(normalised)).slice(0, MAX_FILE_NAME);
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

export async function runPipeline(bytes: Uint8Array, opts: PipelineOptions = {}): Promise<PipelineOutcome> {
  const extract = opts.extract ?? ((b: Uint8Array) => extractInThread(b));
  // extractInThread reports parse_error for a Node Buffer (pooled slice over IPC); hand it a plain Uint8Array copy.
  const r = await extract(new Uint8Array(bytes));
  if ('rejected' in r) {
    return { kind: 'rejected', status: 'rejected', rejectCode: r.rejected, pages: null };
  }
  const meta: ExtractMeta = r;
  const rawName = typeof opts.fileName === 'string' && opts.fileName.trim() ? opts.fileName : null;
  // NFKC can lengthen text (U+FDFA becomes 18 characters), so the cap is applied after normalising, not before.
  const text = normalizeResumeText(r.text).slice(0, MAX_DOC_TEXT);

  const report = assessHealth({ text, meta, fileName: rawName });
  const findings = detectSensitive(text, meta);
  // A sensitive value in the file name counts as a finding of that kind (kind only; the name is never masked into text).
  const nameFindings = rawName ? detectSensitive(normalizeResumeText(rawName)) : [];
  const nameKinds = nameFindings.map((f) => f.kind);
  // The sealed copy of the name is masked too: a number in the file name must not sit in parsed_enc or GET /resumes/{id}.
  const fileName = rawName ? maskFileName(rawName) : null;
  const sensitiveKinds = uniq([...findings.map((f) => f.kind), ...nameKinds]);

  const common: Common = {
    pages: meta.pages !== null && meta.pages >= 1 && meta.pages <= 100 ? meta.pages : null,
    textLayer: report.textLayer,
    producerFamily: sanitizeProducerFamily(meta.producerFamily),
    health: report.checks,
    healthPassed: report.passCount,
    healthTotal: 9,
    sensitiveKinds,
  };

  if (report.textLayer === 'none' || report.textLayer === 'garbled') {
    return { kind: 'needs_text', status: 'needs_text', ...common };
  }

  const masked = maskSensitive(text, findings);
  const sections = detectSections(masked).slice(0, MAX_SECTIONS);
  const edu = parseEducation(masked, sections);
  const doc: ParsedResumeDoc = {
    v: PARSED_DOC_VERSION,
    fileName,
    text: masked,
    sections,
    education: edu.entries.slice(0, MAX_EDUCATION).map((e) => ({ ...e, evidence: e.evidence.slice(0, MAX_EVIDENCE) })),
    backlogs: edu.backlogs,
    lateralEntry: edu.lateralEntry,
  };
  return { kind: 'parsed', status: 'parsed', doc, ...common };
}
