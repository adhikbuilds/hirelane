import { z } from 'zod';
import { idSchema } from '../schema';
import { CAMPUS_METRICS, SHARE_LEVELS } from './inputs';

const ts = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CohortViewSchema = z.strictObject({ id: idSchema, passoutYear: z.number().int(), programme: z.string() });
export const MembershipSchema = z.strictObject({
  campus: z.strictObject({ id: idSchema, name: z.string(), cgpaRule: z.unknown().nullable() }),
  cohort: CohortViewSchema,
  shareLevel: z.enum(SHARE_LEVELS),
  verifiedVia: z.enum(['code', 'email', 'roster']),
  verified: z.boolean(),
  placed: z.boolean(),
  joinedAt: ts,
});
export const MyCampusSchema = z.strictObject({ membership: MembershipSchema.nullable() });
export const JoinResultSchema = z.union([
  z.strictObject({ status: z.literal('choose_cohort'), campus: z.strictObject({ id: idSchema, name: z.string() }), cohorts: z.array(CohortViewSchema) }),
  z.strictObject({ status: z.literal('joined'), verifiedVia: z.enum(['code', 'email', 'roster']) }),
]);
export const EmailSentSchema = z.strictObject({ sent: z.literal(true) });
export const ShareResultSchema = z.strictObject({ shareLevel: z.enum(SHARE_LEVELS) });
export const LeaveResultSchema = z.strictObject({ left: z.boolean() });
export const AccessLogSchema = z.strictObject({
  entries: z.array(z.strictObject({ id: idSchema, campusId: idSchema, action: z.string(), at: ts })),
});

export const DriveForStudentSchema = z.strictObject({
  id: idSchema,
  title: z.string(),
  link: z.string().nullable(),
  noticeText: z.string(),
  /** Closing date (YYYY-MM-DD, India), or null when none was set. */
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  rounds: z.string().nullable(),
  documents: z.string().nullable(),
  publishedAt: ts,
  verdict: z.enum(['eligible', 'unknown']),
  reasons: z.array(z.string()),
  /** The same rules as `reasons`, each with its own status (a rule the student passed stays "pass" on a drive we could not fully check). */
  rules: z.array(z.strictObject({ text: z.string(), status: z.enum(['pass', 'unknown']) })),
});
export const MyDrivesSchema = z.strictObject({ placed: z.boolean(), drives: z.array(DriveForStudentSchema) });

export const OutcomeSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['interview', 'offer', 'higher_studies']),
  employer: z.string(),
  roleTitle: z.string().nullable(),
  packageLpa: z.number().nullable(),
  verification: z.enum(['student_reported', 'tpo_verified']),
  hasLetter: z.boolean(),
  createdAt: ts,
});
export const MyOutcomesSchema = z.strictObject({ outcomes: z.array(OutcomeSchema) });
export const LetterResultSchema = z.strictObject({ id: idSchema, hasLetter: z.literal(true) });

const MetricValue = z.strictObject({ metric: z.string(), value: z.number().int().nullable(), suppressed: z.boolean() });
export const TpoMeSchema = z.strictObject({
  campuses: z.array(z.strictObject({ campusId: idSchema, campusName: z.string(), role: z.enum(['owner', 'staff']) })),
  /** An invite for my verified mailbox is waiting. POST /api/v1/tpo/claim takes it; reading this writes nothing. */
  pendingInvite: z.boolean(),
});
export const TpoClaimSchema = z.strictObject({ claimed: z.number().int() });
export const NaacPreviewSchema = z.strictObject({ filename: z.string(), rows: z.number().int(), header: z.array(z.string()) });
export const TpoCohortsSchema = z.strictObject({
  cohorts: z.array(
    z.strictObject({
      id: idSchema,
      passoutYear: z.number().int(),
      programme: z.string(),
      rosterSize: z.number().int(),
      snapshotDay: day.nullable(),
      joined: z.number().int().nullable(),
      joinedSuppressed: z.boolean(),
    }),
  ),
});
export const CohortCreatedSchema = z.strictObject({ id: idSchema, created: z.boolean() });
export const CohortStatsSchema = z.strictObject({ day: day.nullable(), metrics: z.array(MetricValue.extend({ metric: z.enum(CAMPUS_METRICS) })) });
export const DriveSchema = z.strictObject({
  id: idSchema,
  cohortId: idSchema,
  title: z.string(),
  link: z.string().nullable(),
  /** draft: saved, not yet announced. live: students can see it. closed: ended, or its deadline passed. */
  status: z.enum(['draft', 'live', 'closed']),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  rounds: z.string().nullable(),
  documents: z.string().nullable(),
  /** Staff only: this schema is for the TPO routes. */
  scamRisk: z.enum(['none', 'low', 'medium', 'high']),
  scamFlags: z.array(z.unknown()),
  criteria: z.array(z.unknown()),
  publishedAt: ts,
  announcedAt: ts.nullable(),
});
export const DrivePublishedSchema = z.strictObject({ id: idSchema, criteria: z.array(z.unknown()), scamRisk: z.enum(['none', 'low', 'medium', 'high']), scamFlags: z.array(z.unknown()) });
export const DrivesListSchema = z.strictObject({ drives: z.array(DriveSchema) });
export const DriveCountsSchema = z.strictObject({ day: day.nullable(), metrics: z.array(MetricValue) });
export const TpoOutcomesSchema = z.strictObject({
  outcomes: z.array(
    z.strictObject({
      id: idSchema,
      kind: z.enum(['interview', 'offer', 'higher_studies']),
      employer: z.string(),
      roleTitle: z.string().nullable(),
      packageLpa: z.number().nullable(),
      verification: z.enum(['student_reported', 'tpo_verified']),
      createdAt: ts,
      verifiedAt: ts.nullable(),
      studentName: z.string().nullable(),
      studentEmail: z.string().nullable(),
      memberVerified: z.boolean(),
      programme: z.string(),
      passoutYear: z.number().int(),
      cohortId: idSchema,
      hasLetter: z.boolean(),
    }),
  ),
});
export const OutcomeVerifiedSchema = z.strictObject({ id: idSchema, verification: z.literal('tpo_verified') });
export const RosterResultSchema = z.strictObject({ rowsTotal: z.number().int(), rowsValid: z.number().int(), rowsRejected: z.number().int() });
export const StaffRemovedSchema = z.strictObject({ status: z.literal('removed') });
export const OwnershipTransferredSchema = z.strictObject({ status: z.literal('transferred') });
export const InviteResultSchema = z.strictObject({ status: z.enum(['invited', 'exists']) });
export const StaffListSchema = z.strictObject({ staff: z.array(z.strictObject({ id: idSchema, role: z.enum(['owner', 'staff']), claimed: z.boolean(), createdAt: ts, expiresAt: ts.nullable(), expired: z.boolean() })) });
