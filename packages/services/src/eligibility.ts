import { z } from 'zod';
import type { ServiceCtx } from './ctx';
import { withUserTx, type UserClient } from './db';
import { mapPgError } from './errors';
import { parseInput } from './schema';

const pct = z.number().min(0).max(100);
const count = (max: number) => z.number().int().min(0).max(max);

/** Columns an eligibility profile holds (snake_case, matching engine EligibilityProfileInput). Omitted means unknown (NULL). */
export const ELIGIBILITY_FIELDS = [
  'pct_10',
  'board_10',
  'secondary_kind',
  'pct_secondary',
  'board_secondary',
  'degree',
  'branch_code',
  'branch_raw',
  'grad_score',
  'grad_scale',
  'grad_pct_equiv',
  'grad_conversion',
  'grad_is_final',
  'active_backlogs',
  'backlog_history',
  'gap_years',
  'passout_year',
  'lateral_entry',
] as const;
export type EligibilityField = (typeof ELIGIBILITY_FIELDS)[number];
const NUMERIC_FIELDS: readonly EligibilityField[] = ['pct_10', 'pct_secondary', 'grad_score', 'grad_pct_equiv'];
const INT_FIELDS: readonly EligibilityField[] = ['grad_scale', 'active_backlogs', 'backlog_history', 'gap_years', 'passout_year'];

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const EligibilityValues = z
  .strictObject({
    pct_10: pct.optional(),
    board_10: z.string().trim().min(1).max(80).optional(),
    secondary_kind: z.enum(['12th', 'diploma']).optional(),
    pct_secondary: pct.optional(),
    board_secondary: z.string().trim().min(1).max(80).optional(),
    degree: z.string().trim().min(1).max(80).optional(),
    branch_code: z.string().regex(/^[A-Za-z0-9_]{1,24}$/).optional(),
    branch_raw: z.string().trim().min(1).max(120).optional(),
    grad_score: z.number().min(0).max(100).optional(),
    grad_scale: z.union([z.literal(4), z.literal(5), z.literal(10), z.literal(100)]).optional(),
    grad_pct_equiv: pct.optional(),
    grad_conversion: z.string().regex(new RegExp(`^(direct|unknown|campus:${UUID_RE})$`)).optional(),
    grad_is_final: z.boolean().optional(),
    active_backlogs: count(50).optional(),
    backlog_history: count(100).optional(),
    gap_years: count(20).optional(),
    passout_year: z.number().int().min(1990).max(2100).optional(),
    lateral_entry: z.boolean().optional(),
  })
  .refine((v) => v.grad_score === undefined || v.grad_scale === undefined || v.grad_score <= v.grad_scale, { path: ['grad_score'], message: 'above scale' });
export type EligibilityValues = z.infer<typeof EligibilityValues>;

export const FieldMeta = z.partialRecord(
  z.enum(ELIGIBILITY_FIELDS),
  z.strictObject({ source: z.enum(['resume', 'user']), confidence: z.enum(['high', 'low']).default('high') }),
);
export type FieldMeta = z.infer<typeof FieldMeta>;

export interface EligibilityView extends Partial<Record<EligibilityField, string | number | boolean>> {
  field_meta: FieldMeta;
  source_resume_id: string | null;
  confirmed_at: string;
  updated_at: string;
}

/** pg returns numeric as string; convert explicitly. */
function toView(row: Record<string, unknown>): EligibilityView {
  const out: Record<string, unknown> = {};
  for (const f of ELIGIBILITY_FIELDS) {
    const v = row[f];
    if (v === null || v === undefined) continue;
    out[f] = NUMERIC_FIELDS.includes(f) || INT_FIELDS.includes(f) ? Number(v) : v;
  }
  out['field_meta'] = row['field_meta'] ?? {};
  out['source_resume_id'] = (row['source_resume_id'] as string | null) ?? null;
  out['confirmed_at'] = (row['confirmed_at'] as Date).toISOString();
  out['updated_at'] = (row['updated_at'] as Date).toISOString();
  return out as unknown as EligibilityView;
}

/** Shared by saveEligibility and resume confirm (same transaction). Writes only on an explicit confirmation. */
export async function upsertEligibility(
  client: UserClient,
  ctx: ServiceCtx,
  values: EligibilityValues,
  meta: FieldMeta,
  sourceResumeId: string | null,
): Promise<void> {
  const now = ctx.now();
  const cols = ['user_id', ...ELIGIBILITY_FIELDS, 'field_meta', 'source_resume_id', 'confirmed_at', 'updated_at'];
  const params: unknown[] = [ctx.userId, ...ELIGIBILITY_FIELDS.map((f) => values[f] ?? null), JSON.stringify(meta), sourceResumeId, now, now];
  const marks = cols.map((c, i) => (c === 'field_meta' ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const sets = cols.filter((c) => c !== 'user_id').map((c) => `${c} = EXCLUDED.${c}`);
  await client.query(
    `INSERT INTO eligibility_profiles (${cols.join(', ')}) VALUES (${marks.join(', ')}) ON CONFLICT (user_id) DO UPDATE SET ${sets.join(', ')}`,
    params,
  );
}

export async function getEligibility(ctx: ServiceCtx): Promise<EligibilityView | null> {
  try {
    return await withUserTx(ctx, async (c) => {
      const r = await c.query('SELECT * FROM eligibility_profiles WHERE user_id = $1', [ctx.userId]);
      return r.rows[0] ? toView(r.rows[0]) : null;
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

export const SaveInput = z.strictObject({ values: EligibilityValues });

/** The student edits their numbers on /you/eligibility: that is a confirmation, so confirmed_at moves. */
export async function saveEligibility(ctx: ServiceCtx, input: unknown): Promise<EligibilityView> {
  const { values } = parseInput(SaveInput, input);
  try {
    return await withUserTx(ctx, async (c) => {
      const prev = await c.query('SELECT source_resume_id FROM eligibility_profiles WHERE user_id = $1', [ctx.userId]);
      const meta: FieldMeta = {};
      // Fields the student sets or keeps are theirs; a field they cleared drops its provenance.
      for (const f of ELIGIBILITY_FIELDS) if (values[f] !== undefined) meta[f] = { source: 'user', confidence: 'high' };
      await upsertEligibility(c, ctx, values, meta, (prev.rows[0]?.source_resume_id as string | undefined) ?? null);
      const r = await c.query('SELECT * FROM eligibility_profiles WHERE user_id = $1', [ctx.userId]);
      return toView(r.rows[0]);
    });
  } catch (e) {
    throw mapPgError(e);
  }
}
