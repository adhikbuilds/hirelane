import { z } from 'zod';
import { idSchema } from '../schema';
import { APPLICATION_STATUSES, INBOUND_KINDS, PLATFORMS } from './inputs';

const ts = z.string().datetime({ offset: true });

export const FallbackSchema = z.strictObject({ message: z.string(), url: z.string() });
export const ApplicationSummarySchema = z.strictObject({
  id: idSchema,
  status: z.enum(APPLICATION_STATUSES),
  company: z.string(),
  title: z.string(),
  platform: z.enum(PLATFORMS),
  undoUntil: ts,
  /** True only while status is ready and the window is open. */
  canUndo: z.boolean(),
  blockedReason: z.string().nullable(),
  /** Set when the form could not be submitted for the student: "finish on their site", with the link. */
  fallback: FallbackSchema.nullable(),
  needsYouCount: z.number().int(),
  lastReply: z.enum(INBOUND_KINDS).nullable(),
  createdAt: ts,
  submittedAt: ts.nullable(),
});
export const ApplicationListSchema = z.strictObject({ applications: z.array(ApplicationSummarySchema) });

export const AnswerLineSchema = z.strictObject({
  fieldId: z.string(),
  /** The answer bank key this question maps to; a Needs-you line is answered once by PUT /apply/answers with this key. */
  questionKey: z.string().nullable(),
  label: z.string(),
  required: z.boolean(),
  needsYou: z.boolean(),
  reason: z.string().nullable(),
  answer: z.string().nullable(),
  /** A draft the engine composed from a template. It is never sent: the student confirms or edits it first. Null when there is none. */
  suggestion: z.string().nullable(),
  /** "source:field" pairs the answer rests on. Never the value. */
  sources: z.array(z.string()),
});
export const ReceiptSchema = z.strictObject({
  answersHash: z.string(),
  resumeId: idSchema.nullable(),
  resumeVersion: z.number().int().nullable(),
  platform: z.enum(PLATFORMS),
  resultCode: z.string(),
  sent: z.boolean(),
  httpStatus: z.number().int().nullable(),
  at: ts,
});
export const InboundMessageSchema = z.strictObject({
  id: idSchema,
  applicationId: idSchema.nullable(),
  employer: z.string(),
  kind: z.enum(INBOUND_KINDS),
  matchedBy: z.enum(['company', 'domain', 'none']),
  subject: z.string(),
  excerpt: z.string(),
  receivedAt: ts,
});
export const ApplicationDetailSchema = z.strictObject({
  application: ApplicationSummarySchema,
  applyAddress: z.string().nullable(),
  answers: z.array(AnswerLineSchema),
  receipt: ReceiptSchema.nullable(),
  messages: z.array(InboundMessageSchema),
});

export const SwipeResultSchema = z.strictObject({
  application: z.strictObject({ id: idSchema, status: z.enum(APPLICATION_STATUSES), undoUntil: ts, created: z.boolean() }),
  applyAddress: z.string(),
  autoApply: z.boolean(),
});
export const UndoResultSchema = z.strictObject({ id: idSchema, status: z.literal('undone') });
export const ApplicationRearmedSchema = z.strictObject({ id: idSchema, status: z.literal('ready'), undoUntil: z.string() });
export const ApplicationFinishedSchema = z.strictObject({ id: idSchema, status: z.literal('submitted') });

export const InboxSchema = z.strictObject({ unread: z.number().int(), messages: z.array(InboundMessageSchema) });
export const InboxReadSchema = z.strictObject({ marked: z.number().int() });

export const AnswerBankEntrySchema = z.strictObject({
  id: idSchema,
  questionKey: z.string(),
  labelSeen: z.string().nullable(),
  sensitive: z.boolean(),
  source: z.enum(['user', 'resume']),
  answer: z.string(),
  updatedAt: ts,
});
export const AnswerBankSchema = z.strictObject({ answers: z.array(AnswerBankEntrySchema) });
export const AnswerDeletedSchema = z.strictObject({ deleted: z.literal(true) });

export const ApplySettingsSchema = z.strictObject({ autoApply: z.boolean(), decidedAt: ts.nullable(), applyAddress: z.string().nullable() });
