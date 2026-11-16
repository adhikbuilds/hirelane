import { z } from 'zod';
import { idSchema } from '../schema';
import { isRealDay } from './ist';

export const SHARE_LEVELS = ['aggregate', 'outcomes', 'full'] as const;
export type ShareLevel = (typeof SHARE_LEVELS)[number];

/** The fixed metric list a TPO can read (docs: 0011a tpo_cohort_stats). There are no caller-supplied filters or dimensions. */
export const CAMPUS_METRICS = [
  'joined_verified',
  'stage_no_resume',
  'stage_resume_unconfirmed',
  'stage_confirmed',
  'ats_readable',
  'blocker_active_backlog',
  'blocker_grad_below_60',
  'blocker_secondary_below_60',
  'blocker_gap_year',
  'interview_reported',
  'offer_reported',
  'placed_on_roster',
] as const;
export type CampusMetric = (typeof CAMPUS_METRICS)[number];

export const JoinCodeInput = z.strictObject({ code: z.string().min(1).max(40), cohortId: idSchema.optional() });
export const JoinEmailStartInput = z.strictObject({ email: z.string().min(3).max(254) });
export const JoinEmailVerifyInput = z.strictObject({ email: z.string().min(3).max(254), code: z.string().regex(/^\d{6}$/), cohortId: idSchema });
export const ShareInput = z.strictObject({ level: z.enum(SHARE_LEVELS) });

export const OutcomeInput = z.strictObject({
  kind: z.enum(['interview', 'offer', 'higher_studies']),
  employer: z.string().trim().min(1).max(160),
  roleTitle: z.string().trim().min(1).max(120).nullable().optional(),
  packageLpa: z.number().min(0).max(1000).nullable().optional(),
}).refine((v) => v.kind !== 'higher_studies' || v.packageLpa == null, { path: ['packageLpa'], message: 'a higher-studies record has no package' });
export const CampusIdInput = z.strictObject({ id: idSchema });

const campusId = idSchema.optional();
export const CohortCreateInput = z.strictObject({
  campusId,
  passoutYear: z.number().int().min(2000).max(2100),
  programme: z.string().trim().min(1).max(80),
});
export const CampusScopeInput = z.strictObject({ campusId });
export const CohortStatsInput = z.strictObject({ cohortId: idSchema, metric: z.enum(CAMPUS_METRICS).optional() });
const driveDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDay, 'not a calendar date');
const driveNote = z.string().trim().max(2000);
export const PublishDriveInput = z.strictObject({
  cohortId: idSchema,
  title: z.string().trim().min(1).max(200),
  noticeText: z.string().trim().min(1).max(20_000),
  link: z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'http(s) only').nullable().optional(),
  /** Closing date, YYYY-MM-DD in India. The console fills it from the notice and the TPO checks it. */
  deadline: driveDay.nullable().optional(),
  /** Free text: "Aptitude test, then two interviews". No scheduling. */
  rounds: driveNote.nullable().optional(),
  /** Free text: "Marksheets, resume, college ID". */
  documents: driveNote.nullable().optional(),
});
export const OutcomesListInput = z.strictObject({ campusId, cohortId: idSchema.optional() });
export const NaacExportInput = z.strictObject({ campusId, passoutYear: z.number().int().min(2000).max(2100).optional() });
/** emailColumn / placedColumn are header names chosen on the import screen; placedColumn null means the file has none. */
export const RosterImportInput = z.strictObject({ cohortId: idSchema, emailColumn: z.string().trim().min(1).max(100).optional(), placedColumn: z.string().trim().min(1).max(100).nullable().optional() });
export const StaffMemberInput = z.strictObject({ campusId, memberId: idSchema });
export const TransferOwnershipBody = z.strictObject({ campusId });
export const InviteInput = z.strictObject({ campusId, email: z.string().min(3).max(254) });
