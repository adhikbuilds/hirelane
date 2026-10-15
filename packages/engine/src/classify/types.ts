import type { Doc } from '../text';
import type { Evidence, Trace } from '../trace';

/** Input shared by the level, workplace, employment and role-family classifiers (contract section 7). */
export interface ClassifyInput {
  title: string;
  /** canonicalTitle().norm */
  titleNorm: string;
  department: string | null;
  team: string | null;
  /** Ashby 'FullTime', Lever 'full time' */
  employmentRaw: string | null;
  /** Ashby 'Hybrid', Lever 'onsite' | 'unspecified' */
  workplaceRaw: string | null;
  /** Ashby isRemote:true appears on a 'Hybrid' posting, so it is a hint only. */
  isRemoteHint: boolean | null;
  locationsRaw: readonly string[];
  doc: Doc;
  /** Max over must requirements, from extractRequirements. */
  yearsMin: number | null;
}

export interface Classified<T> {
  value: T;
  evidence: Evidence[];
  trace: Trace;
}
