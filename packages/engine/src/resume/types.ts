/**
 * Resume contract types (Slice 1, Amendment B). Type-only: no logic, no runtime deps.
 * All offsets are UTF-16 code-unit indexes into the NFKC-normalised text, [start, end).
 */

/** A detected resume section, e.g. education, projects, skills. */
export interface ResumeSection {
  kind: string;
  heading: string;
  start: number;
  end: number;
}

export type EducationLevel = '10th' | '12th' | 'diploma' | 'ug' | 'pg';
export type Confidence = 'high' | 'low';

/** Score as written: a percentage, or a CGPA on a stated scale (4, 5, 10). */
export interface EducationScore {
  kind: 'percent' | 'cgpa';
  value: number;
  /** Scale the value is out of (100 for percent). */
  scale: number;
}

export interface EvidenceSpan {
  start: number;
  end: number;
}

/** One education row. Every field the parser fills is editable on the confirm screen. */
export interface EducationEntry {
  level: EducationLevel;
  board: string | null;
  score: EducationScore | null;
  startYear: number | null;
  passoutYear: number | null;
  degree: string | null;
  branch: string | null;
  confidence: Confidence;
  evidence: EvidenceSpan[];
}

/** Active backlogs and backlog history are kept separate. */
export interface Backlogs {
  active: number | null;
  history: number | null;
}

export type SensitiveKind =
  | 'aadhaar'
  | 'aadhaar_masked'
  | 'vid'
  | 'pan'
  | 'dob'
  | 'parent_name'
  | 'religion'
  | 'caste'
  | 'marital_status'
  | 'image';

export type Severity = 'high' | 'medium' | 'low';

/** Kind and offsets only. By design there is NEVER a value field. */
export interface SensitiveFinding {
  kind: SensitiveKind;
  start: number;
  end: number;
  severity: Severity;
}

export type TextLayer = 'readable' | 'partial' | 'none' | 'garbled';

export type HealthCheckId =
  | 'ats_readable'
  | 'one_page'
  | 'contact_present'
  | 'no_biodata_ids'
  | 'no_padding'
  | 'bullets_with_numbers'
  | 'project_proof_links'
  | 'skills_in_text'
  | 'sensible_file_name';

export interface HealthCheck {
  id: HealthCheckId;
  status: 'pass' | 'fail' | 'unknown';
  reason: string;
  fix: string;
}

export interface PageStat {
  chars: number;
  images: number;
}

export interface ExtractFlags {
  javascript: boolean;
  embeddedFiles: boolean;
  macros: boolean;
  externalRefs: boolean;
}

/** Metadata the extractor reports alongside the text. */
export interface ExtractMeta {
  kind: 'pdf' | 'docx';
  /** null for DOCX. */
  pages: number | null;
  pageStats: PageStat[];
  imageCount: number;
  encrypted: boolean;
  flags: ExtractFlags;
  producerFamily: string;
}
