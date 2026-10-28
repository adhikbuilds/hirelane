import { z } from 'zod';
import { EligibilityValues, FieldMeta } from './eligibility';
import { ParsedResume } from './parsed';
import { idSchema } from './schema';

/** Response schemas: the contract tests parse real responses with these, and the v1 OpenAPI document is built from them. */
const ts = z.string().datetime({ offset: true });

export const ResumeSummarySchema = z.strictObject({
  id: idSchema,
  parentId: idSchema.nullable(),
  label: z.string().nullable(),
  source: z.enum(['upload', 'builder']),
  mime: z.string(),
  sizeBytes: z.number().int().nullable(),
  pages: z.number().int().nullable(),
  textLayer: z.string().nullable(),
  parseStatus: z.enum(['uploaded', 'extracting', 'parsed', 'needs_text', 'rejected', 'failed', 'confirmed', 'draft']),
  rejectCode: z.string().nullable(),
  parsedVersion: z.number().int(),
  healthPassed: z.number().int(),
  healthTotal: z.number().int(),
  sensitiveKinds: z.array(z.string()),
  skills: z.array(z.string()),
  confirmedAt: ts.nullable(),
  isDefault: z.boolean(),
  createdAt: ts,
  updatedAt: ts,
});
export const ResumeViewSchema = ResumeSummarySchema.extend({ health: z.array(z.unknown()), parsed: ParsedResume.nullable() });
export const ResumeListSchema = z.strictObject({ resumes: z.array(ResumeSummarySchema) });
export const UploadResultSchema = z.strictObject({ id: idSchema, status: z.literal('uploaded') });
export const ConfirmResultSchema = ResumeSummarySchema.extend({ eligibilityConfirmedAt: ts });
export const DeleteResultSchema = z.strictObject({ id: idSchema, deleted: z.literal(true) });
export const EligibilityViewSchema = z.strictObject({
  ...EligibilityValues.shape,
  field_meta: FieldMeta,
  source_resume_id: idSchema.nullable(),
  confirmed_at: ts,
  updated_at: ts,
});
export const EligibilityGetSchema = z.strictObject({ eligibility: EligibilityViewSchema.nullable() });
export const BuilderStateSchema = z.strictObject({ draftId: idSchema, answered: z.array(z.string()), missing: z.array(z.string()) });
export const BuilderFinishSchema = z.strictObject({ id: idSchema, status: z.literal('rendering') });
export const MeSchema = z.strictObject({ id: idSchema, email: z.string(), displayName: z.string().nullable(), role: z.string(), createdAt: ts });
export const ProblemSchema = z.strictObject({
  type: z.literal('about:blank'),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  requestId: z.string(),
  issues: z.array(z.strictObject({ path: z.string(), code: z.string() })).optional(),
});
