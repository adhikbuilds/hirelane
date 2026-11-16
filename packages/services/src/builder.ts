import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parsedAad } from './aad';
import type { ServiceCtx } from './ctx';
import { withUserTx } from './db';
import { mapPgError, notFound, ServiceError } from './errors';
import { BUILDER_REQUIRED, BUILDER_STEPS, BuilderAnswersSchema, STEP_KEYS, StepData, type BuilderStep } from './builder-steps';
import { ParsedResume } from './parsed';
import { idSchema, parseInput } from './schema';
import { openJson, sealJson } from './seal';
import { PDF_MIME } from './resumes';

export interface BuilderState {
  draftId: string;
  answered: string[];
  missing: string[];
}

const step = <S extends BuilderStep>(name: S) => z.strictObject({ draftId: idSchema.optional(), step: z.literal(name), data: StepData[name] });
/** One question's answer. The first call (no draftId) creates the draft. */
export const StepInput = z.discriminatedUnion('step', [
  step('contact'),
  step('education'),
  step('skills'),
  step('projects'),
  step('experience'),
  step('links'),
  step('summary'),
]);

type Answers = Record<string, unknown>;
const has = (a: Answers, s: BuilderStep): boolean => (s === 'contact' ? ['name', 'email', 'phone'].every((k) => a[k] !== undefined) : STEP_KEYS[s].every((k) => a[k] !== undefined));
const state = (draftId: string, answers: Answers): BuilderState => ({
  draftId,
  answered: BUILDER_STEPS.filter((s) => has(answers, s)),
  missing: BUILDER_REQUIRED.filter((s) => !has(answers, s)),
});

/**
 * Saves one answer of the guided builder. The first call creates the draft (a root row, so it counts toward the 3-resume
 * cap) with no file; answers live sealed in parsed_enc. Answers are PII: never logged, never echoed.
 */
export async function saveBuilderStep(ctx: ServiceCtx, input: unknown): Promise<BuilderState> {
  const inp = parseInput(StepInput, input);
  const data = inp.data as Answers;
  try {
    return await withUserTx(ctx, async (c) => {
      const now = ctx.now();
      if (!inp.draftId) {
        const id = randomUUID();
        await c.query(
          `INSERT INTO resumes (id, user_id, source, mime, parse_status, parsed_enc, parsed_version)
           VALUES ($1, $2, 'builder', $3, 'draft', $4, 1)`,
          [id, ctx.userId, PDF_MIME, await sealJson(ctx, parsedAad(ctx.userId, id), { v: 1, answers: data })],
        );
        return state(id, data);
      }
      const row = (
        await c.query("SELECT parse_status, source, parsed_enc FROM resumes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE", [inp.draftId, ctx.userId])
      ).rows[0];
      if (!row || row.source !== 'builder') throw notFound();
      if (row.parse_status !== 'draft') throw new ServiceError('not_a_draft', 409);
      const parsed = ParsedResume.safeParse(await openJson(ctx, parsedAad(ctx.userId, inp.draftId), row.parsed_enc));
      if (!parsed.success) throw new ServiceError('unreadable_record', 500);
      const answers: Answers = { ...(parsed.data.answers ?? {}), ...data };
      await c.query('UPDATE resumes SET parsed_enc = $3, parsed_version = parsed_version + 1, updated_at = $4 WHERE id = $1 AND user_id = $2', [
        inp.draftId,
        ctx.userId,
        await sealJson(ctx, parsedAad(ctx.userId, inp.draftId), { ...parsed.data, answers }),
        now,
      ]);
      return state(inp.draftId, answers);
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

export const FinishInput = z.strictObject({ draftId: idSchema });

/**
 * Queues the PDF render. The runner's resume:render takes the resume id only, then fills in blob_key, size_bytes and
 * file_hmac as the owner role. Enqueued after the read transaction ends; the job key makes a double click harmless.
 */
export async function finishBuilder(ctx: ServiceCtx, input: unknown): Promise<{ id: string; status: 'rendering' }> {
  const { draftId } = parseInput(FinishInput, input);
  try {
    await withUserTx(ctx, async (c) => {
      const row = (
        await c.query("SELECT parse_status, source, parsed_enc FROM resumes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL", [draftId, ctx.userId])
      ).rows[0];
      if (!row || row.source !== 'builder') throw notFound();
      if (row.parse_status !== 'draft') throw new ServiceError('not_a_draft', 409);
      const parsed = ParsedResume.safeParse(await openJson(ctx, parsedAad(ctx.userId, draftId), row.parsed_enc));
      if (!parsed.success) throw new ServiceError('unreadable_record', 500);
      const answers: Answers = parsed.data.answers ?? {};
      const missing = BUILDER_REQUIRED.filter((s) => !has(answers, s));
      if (missing.length) throw new ServiceError('incomplete_draft', 422, missing.map((m) => ({ path: m, code: 'required' })));
      // Nothing the renderer cannot lay out is queued.
      parseInput(BuilderAnswersSchema, answers);
    });
  } catch (e) {
    throw mapPgError(e);
  }
  try {
    await ctx.enqueue('resume:render', { resumeId: draftId }, { jobKey: `resume:render:${draftId}` });
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('queue_unavailable', 503);
  }
  return { id: draftId, status: 'rendering' };
}
