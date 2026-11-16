import { z } from 'zod';

/**
 * The plaintext inside `resumes.parsed_enc`. The worker writes it (as the owner role) after extraction and masking;
 * services read it, and a builder draft keeps its answers here. Findings carry kind and offsets, never a value.
 * Offsets index the masked `text`.
 */
const year = z.number().int().min(1950).max(2100);
const entry = z.looseObject({
  level: z.enum(['10th', '12th', 'diploma', 'ug', 'pg']),
  board: z.string().nullable().default(null),
  score: z
    .strictObject({ kind: z.enum(['percent', 'cgpa']), value: z.number().min(0).max(100), scale: z.number().min(1).max(100) })
    .nullable()
    .default(null),
  startYear: year.nullable().default(null),
  passoutYear: year.nullable().default(null),
  degree: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  confidence: z.enum(['high', 'low']).default('low'),
  evidence: z.array(z.strictObject({ start: z.number().int().min(0), end: z.number().int().min(0) })).max(10).default([]),
});

const finding = z.strictObject({
  kind: z.enum(['aadhaar', 'aadhaar_masked', 'vid', 'pan', 'dob', 'parent_name', 'religion', 'caste', 'marital_status', 'image']),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  severity: z.enum(['high', 'medium', 'low']),
});

export const ParsedResume = z.strictObject({
  v: z.literal(1).default(1),
  /** Original file name: kept only here, sealed. */
  fileName: z.string().max(255).nullable().default(null),
  /** Masked text. */
  text: z.string().max(200_000).default(''),
  education: z.array(entry).max(8).default([]),
  backlogs: z
    .strictObject({ active: z.number().int().min(0).max(50).nullable().default(null), history: z.number().int().min(0).max(100).nullable().default(null) })
    .default({ active: null, history: null }),
  findings: z.array(finding).max(500).default([]),
  sections: z.array(z.looseObject({ kind: z.string(), heading: z.string(), start: z.number().int().min(0), end: z.number().int().min(0) })).max(300).default([]),
  lateralEntry: z.boolean().optional(),
  /** Guided-builder answers (BuilderAnswers shape, possibly partial). Only on a builder draft or a rendered builder resume. */
  answers: z.record(z.string(), z.unknown()).optional(),
  /** The runner carries a draft's answers here after extraction. */
  builder: z.unknown().optional(),
});
export type ParsedResume = z.infer<typeof ParsedResume>;
