import { z } from 'zod';
import { idSchema } from '../schema';

export const APPLICATION_STATUSES = ['ready', 'submitting', 'submitted', 'blocked_fallback', 'failed', 'undone'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const PLATFORMS = ['greenhouse', 'lever', 'ashby'] as const;
export const INBOUND_KINDS = ['interview', 'test', 'rejection', 'other'] as const;

/** The window a student has to take a right swipe back. Mirrors the interval in migration 0012. */
export const UNDO_WINDOW_SECONDS = 4;
/** Consent text version recorded with every auto_apply toggle. */
export const AUTO_APPLY_DOC_VERSION = 'auto-apply-2026-10-29';

export const SwipeInput = z.strictObject({ jobId: idSchema, resumeId: idSchema.optional() });
export const ApplicationIdInput = z.strictObject({ id: idSchema });
export const ListApplicationsInput = z.strictObject({
  status: z.enum(APPLICATION_STATUSES).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export const AnswerKeyRe = /^[a-z0-9_.:-]{1,80}$/;
export const AnswerInput = z.strictObject({
  questionKey: z.string().regex(AnswerKeyRe),
  answer: z.string().trim().min(1).max(2000),
  labelSeen: z.string().trim().min(1).max(300).optional(),
  sensitive: z.boolean().optional(),
});
export const AnswerIdInput = z.strictObject({ id: idSchema });
export const AutoApplyInput = z.strictObject({ granted: z.boolean() });
