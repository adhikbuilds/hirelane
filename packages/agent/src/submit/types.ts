/**
 * The auto-apply executor's vocabulary. This folder (packages/agent/src/submit/) is the ONLY place submission code may live
 * (scripts/no-submit-guard.ts, dependency-cruiser rule submit-is-isolated). Pure: no database, no clock, no network of its own.
 * Everything it touches (consent, cap, kill switch, answers, the resume, the HTTP transport) is a port the caller passes in.
 */
export type Platform = 'greenhouse' | 'lever' | 'ashby';
export const PLATFORMS: readonly Platform[] = ['greenhouse', 'lever', 'ashby'];

export type FieldKind = 'text' | 'textarea' | 'email' | 'phone' | 'url' | 'number' | 'select' | 'multiselect' | 'boolean' | 'file' | 'captcha';
export type FileRole = 'resume' | 'cover_letter' | 'other';

export interface FieldOption {
  label: string;
  value: string;
}
export interface FormField {
  /** The name the form submits this field under. */
  id: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options?: FieldOption[];
  /** Only for kind 'file'. */
  fileRole?: FileRole;
}

/** What a platform's public application form asks, in one shape. */
export interface FormSpec {
  platform: Platform;
  fields: FormField[];
  /** Set when the form itself carries a CAPTCHA, a bot-check or a login wall. */
  block: BlockKind | null;
}

export type BlockKind = 'captcha' | 'challenge' | 'login';

export class FormParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormParseError';
  }
}

// ---------------------------------------------------------------- transport

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
}
export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
/** The only way the executor reaches a network. The default refuses every host that is not a fixture host. */
export interface Transport {
  send(req: HttpRequest): Promise<HttpResponse>;
}

/** Thrown by the default transport for a host that is not a fixture host. The executor turns it into "finish on their site". */
export class TransportRefused extends Error {
  readonly host: string;
  constructor(host: string) {
    super('transport refused: not a fixture host');
    this.name = 'TransportRefused';
    this.host = host;
  }
}

// ---------------------------------------------------------------- ports

export interface GatePort {
  /** The student's newest auto_apply consent is a yes. */
  hasConsent(): Promise<boolean>;
  /** The student still has a slot today (this attempt included). */
  underDailyCap(): Promise<boolean>;
  /** The platform's kill switch is on (submitting allowed). */
  platformEnabled(platform: Platform): Promise<boolean>;
  /**
   * The resume that would be sent holds no sensitive item (Aadhaar, PAN, DOB, caste, religion, photo ...), or the student confirmed it.
   * Optional so older callers keep working; when present and false the attempt ends as "finish on their site" (sensitive_resume).
   */
  resumeCleared?(): Promise<boolean>;
}

export interface EvidenceRef {
  source: string;
  field: string;
}
export interface ResolvedAnswer {
  /** The answer key the question was matched to (engine AnswerKey or 'unknown'). */
  key: string;
  status: 'filled' | 'needs_you';
  value: string | null;
  /** A filled answer without evidence is treated as needs_you. */
  evidence: EvidenceRef[];
  reason?: string;
}
export interface QuestionAsked {
  label: string;
  kind: FieldKind;
  options?: string[];
}
export interface AnswerPort {
  resolve(q: QuestionAsked): ResolvedAnswer | Promise<ResolvedAnswer>;
}

export interface ResumeFile {
  id: string;
  version: number;
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

export interface SubmitJob {
  applicationId: string;
  platform: Platform;
  applyUrl: string;
}
export interface SubmitPorts {
  gate: GatePort;
  answers: AnswerPort;
  transport: Transport;
  /** The resume to attach, or null when the student has none. */
  resume: () => Promise<ResumeFile | null>;
  now: () => Date;
}
export interface SubmitOptions {
  /**
   * 'all' (default, the owner's rule): any unanswered Needs-you question blocks the submission.
   * 'required': only an unanswered required question blocks; optional ones are left blank. Not used by the worker.
   */
  blockOn?: 'all' | 'required';
}

export interface BuiltAnswer {
  fieldId: string;
  label: string;
  required: boolean;
  key: string;
  needsYou: boolean;
  reason: string | null;
  value: string | null;
  evidence: EvidenceRef[];
}

export type OutcomeState = 'submitted' | 'blocked_fallback' | 'failed';
export interface ReceiptData {
  answersHash: string;
  resumeId: string | null;
  resumeVersion: number | null;
  platform: Platform;
  resultCode: string;
  /** True when a request carrying the answers was sent. */
  sent: boolean;
  httpStatus: number | null;
  at: Date;
}
export interface SubmitOutcome {
  state: OutcomeState;
  /** Stable machine code: accepted, no_consent, daily_cap, platform_paused, needs_you, captcha, challenge, login, live_disabled, ... */
  code: string;
  /** Present on blocked_fallback. */
  message: 'finish on their site' | null;
  answers: BuiltAnswer[];
  receipt: ReceiptData;
  /** The checks that ran, in order. For the audit trail and the tests. */
  steps: string[];
}
