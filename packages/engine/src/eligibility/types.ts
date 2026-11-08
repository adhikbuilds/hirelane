/**
 * Eligibility contract types (Slice 1, Amendment B sections 7 and 8). Type-only.
 */
import type { EvidenceSpan } from '../resume/types';

export type CriterionLevel = '10th' | '12th' | 'diploma' | 'ug' | 'pg';

/** Offsets of the posting text that produced a criterion. */
interface WithEvidence {
  evidence: EvidenceSpan[];
}

export type Criterion =
  | (WithEvidence & {
      type: 'min_score';
      levels: CriterionLevel[];
      pct: number;
      cgpa?: number;
      /** "60% throughout": applies at every level. */
      throughout: boolean;
    })
  | (WithEvidence & { type: 'no_active_backlogs' })
  | (WithEvidence & { type: 'max_backlog_history'; n: number })
  | (WithEvidence & { type: 'passout_years'; years: number[] })
  | (WithEvidence & { type: 'degrees'; list: string[] })
  | (WithEvidence & { type: 'branches'; list: string[] })
  | (WithEvidence & { type: 'max_gap_years'; n: number });

/** Plain eligibility_profiles columns. Every field optional; written only on confirm. */
export interface EligibilityProfileInput {
  pct_10?: number;
  board_10?: string;
  secondary_kind?: '12th' | 'diploma';
  pct_secondary?: number;
  board_secondary?: string;
  degree?: string;
  branch_code?: string;
  branch_raw?: string;
  grad_score?: number;
  grad_scale?: 4 | 5 | 10 | 100;
  grad_pct_equiv?: number;
  /** `campus:<id>` | 'direct' | 'unknown' */
  grad_conversion?: string;
  grad_is_final?: boolean;
  active_backlogs?: number;
  backlog_history?: number;
  gap_years?: number;
  passout_year?: number;
  lateral_entry?: boolean;
  /** The student's own scheme ("2022"), for universities with one formula per scheme. Never derived from the passout year. */
  university_scheme?: string;
  admission_year?: number;
  /** Nothing is evaluated until the student confirms. */
  confirmed: true;
}

/** campuses.cgpa_rule: pct = a * cgpa + b. null means no rule, so CGPA vs % is unknown. */
/** `unverified` is set by ops --force-unverified: the rule was written against a scheme-keyed or disputed university. */
export type CgpaRule = { kind: 'linear'; a: number; b: number; unverified?: true } | null;

export type VerdictStatus = 'pass' | 'fail' | 'unknown';

/** Where a minimum-score rule is checked: one entry per level, so a "throughout" notice gets one verdict each. */
export type VerdictLevel = '10th' | '12th' | 'diploma' | 'graduation';

export interface LevelVerdict {
  level: VerdictLevel;
  status: VerdictStatus;
  /** Plain English with the maths shown. */
  reason: string;
  profileField?: keyof EligibilityProfileInput;
}

export interface CriterionVerdict {
  criterion: Criterion;
  status: VerdictStatus;
  /** Plain English with the maths shown. */
  reason: string;
  profileField?: keyof EligibilityProfileInput;
  /** Present on min_score criteria. */
  levels?: LevelVerdict[];
}

export interface EligibilityResult {
  overall: VerdictStatus;
  verdicts: CriterionVerdict[];
}
