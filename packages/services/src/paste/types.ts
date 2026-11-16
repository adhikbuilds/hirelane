import { z } from 'zod';

/** POST /api/v1/paste input. The link is kept as a string to read the site from; it is never fetched. */
export const PasteInput = z.strictObject({
  text: z.string().min(20).max(20_000),
  url: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), 'http(s) only')
    .nullable()
    .optional(),
});
export type PasteInput = z.infer<typeof PasteInput>;

const rule = z.strictObject({ text: z.string(), status: z.enum(['pass', 'fail', 'unknown']) });

export const PasteResultSchema = z.strictObject({
  job: z.strictObject({
    title: z.string().nullable(),
    company: z.string().nullable(),
    locations: z.array(z.string()),
    workplace: z.string().nullable(),
    level: z.string().nullable(),
    fresher: z.strictObject({ fresher: z.boolean(), reason: z.string() }),
    pay: z.strictObject({ stated: z.boolean(), text: z.string() }),
    /** A link found in the paste. Shown, never opened. */
    applyUrl: z.string().nullable(),
    source: z.enum(['naukri', 'linkedin', 'whatsapp', 'other']),
  }),
  eligibility: z.strictObject({
    overall: z.enum(['eligible', 'not_eligible', 'check']),
    rules: z.array(rule),
  }),
  fit: z.strictObject({
    verdict: z.enum(['worthwhile', 'not_worthwhile', 'suspicious']),
    mustHaves: z.strictObject({ matched: z.number().int(), total: z.number().int(), matchedSkills: z.array(z.string()), missingSkills: z.array(z.string()) }),
    conditions: z.array(z.strictObject({ name: z.string(), pass: z.boolean(), detail: z.string() })),
    locationFit: z.boolean(),
  }),
  scam: z.strictObject({
    risk: z.enum(['none', 'low', 'medium', 'high']),
    flagged: z.boolean(),
    signals: z.array(z.strictObject({ id: z.string(), severity: z.string(), quote: z.string() })),
  }),
});
export type PasteResult = z.infer<typeof PasteResultSchema>;
