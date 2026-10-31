/** Application answers without an LLM (decision 1, 2026-10-29). Type-only. */
import type { EligibilityProfileInput } from '../eligibility/types';
import type { UniversityRule } from '../eligibility/university';

/** Keys a form question can map to. Never a guess: anything else is 'unknown'. */
export const ANSWER_KEYS = [
  'name', 'email', 'phone', 'grad_year', 'degree', 'cgpa', 'percentage', 'cgpa_pct', 'pct_10', 'pct_12',
  'notice_period', 'relocation', 'expected_ctc', 'current_ctc', 'linkedin', 'github',
  'work_authorization', 'visa_sponsorship', 'gender_eeo', 'sensitive_id',
  'why_company', 'why_role', 'about_yourself',
] as const;
export type AnswerKey = (typeof ANSWER_KEYS)[number];
export type QuestionKey = AnswerKey | 'unknown';

export interface Classification {
  key: QuestionKey;
  /** What told us: the label wording, the option list, or nothing. */
  via: 'label' | 'options' | 'none';
}

export interface AnswerProfile {
  fullName?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  github?: string;
  degree?: string;
  passoutYear?: number;
  workAuthorizations?: { country: string; status: 'citizen' | 'permanent' | 'visa_held' | 'needs_sponsorship' }[];
  /** The confirmed eligibility profile. Ignored unless confirmed is true. */
  eligibility?: EligibilityProfileInput;
}

/** One row of the student's answer bank, already opened. */
export interface AnswerBankEntry {
  questionKey: string;
  answer: string;
  source: 'user' | 'resume';
}

export interface ResumeFacts {
  /** The student confirmed the parse. Nothing from the resume is used before that. */
  confirmed: boolean;
  skills: string[];
  projects: { title: string }[];
  experience: { role: string; org: string }[];
  links: string[];
}

export interface CompanyFacts {
  name: string;
  /** One line about what the company does, as the company wrote it. */
  about: string;
  /** Title of the role being applied for. */
  role?: string;
}

export interface AnswerOptions {
  /** ISO country of the job, for work authorisation questions. */
  country?: string;
  universityRule?: UniversityRule | null;
  universityRuleConfirmed?: boolean;
  campusRule?: { kind: 'linear'; a: number; b: number } | null;
}

export type AnswerEvidenceSource = 'profile' | 'answer_bank' | 'resume' | 'company' | 'rule';
export interface AnswerEvidence {
  source: AnswerEvidenceSource;
  field: string;
  /** Direct answers: equals the answer. Template parts: appears verbatim inside the answer. */
  value: string;
  /** The maths, for a derived value. */
  basis?: string;
}

export interface Answer {
  key: QuestionKey;
  status: 'filled' | 'needs_you';
  value: string | null;
  evidence: AnswerEvidence[];
  /** Why it needs the student. */
  reason?: string;
}

export type AnswerSet = Record<AnswerKey, Answer>;

export interface AnswerInputs {
  profile: AnswerProfile;
  answerBank: AnswerBankEntry[];
  resumeFacts: ResumeFacts;
  company: CompanyFacts | null;
}
