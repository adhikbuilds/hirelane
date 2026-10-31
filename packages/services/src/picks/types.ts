import { z } from 'zod';
import { idSchema } from '../schema';

/** Response schemas for GET /api/v1/picks. The v1 OpenAPI document is built from these, and the contract tests parse real responses with them. */
const ts = z.string().datetime({ offset: true });

export const PickRuleSchema = z.strictObject({
  /** Plain English from the engine, with the maths shown ("Your graduation 74.1% is at least the 60% asked"). */
  text: z.string(),
  status: z.enum(['pass', 'unknown']),
});

export const PickSchema = z.strictObject({
  jobId: idSchema,
  slug: z.string(),
  company: z.string(),
  title: z.string(),
  locations: z.array(z.string()),
  remote: z.boolean(),
  /** 1 is the first pick of the day. There is no percentage and no score: the order is the whole signal. */
  rank: z.number().int().min(1),
  /** eligible: every stated rule is met. check: at least one rule could not be checked yet (see rules); nothing failed. */
  eligibility: z.enum(['eligible', 'check']),
  rules: z.array(PickRuleSchema),
  mustHaves: z.strictObject({
    matched: z.number().int(),
    total: z.number().int(),
    matchedSkills: z.array(z.string()),
    missingSkills: z.array(z.string()),
  }),
  pay: z.strictObject({ stated: z.boolean(), text: z.string() }),
  /** People the student knows there, when a source exists. null means no source, not "nobody". */
  whoYouKnow: z.array(z.string()).nullable(),
  posted: z.strictObject({ at: ts, ageDays: z.number().int().min(0), label: z.string() }),
});
export type Pick = z.infer<typeof PickSchema>;

export const PicksSchema = z.strictObject({
  placed: z.boolean(),
  /** The IST day these picks are for. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  picks: z.array(PickSchema).max(10),
});
export type Picks = z.infer<typeof PicksSchema>;
