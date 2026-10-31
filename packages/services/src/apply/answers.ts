import { randomUUID } from 'node:crypto';
import { answerAad } from '../aad';
import type { ServiceCtx } from '../ctx';
import { withUserTx } from '../db';
import { mapPgError, notFound } from '../errors';
import { parseInput } from '../schema';
import { openJson, sealJson } from '../seal';
import { AnswerIdInput, AnswerInput } from './inputs';

export interface AnswerBankEntryView {
  id: string;
  questionKey: string;
  labelSeen: string | null;
  sensitive: boolean;
  source: 'user' | 'resume';
  answer: string;
  updatedAt: string;
}

/** The student's answer bank, opened. Answers are PII: sealed at rest, returned only to their owner. */
export async function listAnswers(ctx: ServiceCtx): Promise<{ answers: AnswerBankEntryView[] }> {
  try {
    return await withUserTx(ctx, async (c) => {
      const out: AnswerBankEntryView[] = [];
      for (const r of (await c.query('SELECT id, question_key, label_seen, answer_enc, sensitive, source, updated_at FROM answer_bank WHERE user_id = $1 ORDER BY question_key', [ctx.userId])).rows) {
        out.push({
          id: r.id,
          questionKey: r.question_key,
          labelSeen: r.label_seen ?? null,
          sensitive: r.sensitive === true,
          source: r.source,
          answer: String(await openJson(ctx, answerAad(ctx.userId, r.id), r.answer_enc)),
          updatedAt: (r.updated_at as Date).toISOString(),
        });
      }
      return { answers: out };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

/** Create or replace the answer for a question key. Editing a row that came from the resume makes it the student's own. */
export async function saveAnswer(ctx: ServiceCtx, input: unknown): Promise<AnswerBankEntryView> {
  const v = parseInput(AnswerInput, input);
  try {
    return await withUserTx(ctx, async (c) => {
      const have = (await c.query('SELECT id FROM answer_bank WHERE user_id = $1 AND question_key = $2', [ctx.userId, v.questionKey])).rows[0];
      const id: string = have ? have.id : randomUUID();
      const sealed = await sealJson(ctx, answerAad(ctx.userId, id), v.answer);
      const r = have
        ? (
            await c.query(
              `UPDATE answer_bank SET answer_enc = $3, label_seen = COALESCE($4, label_seen), sensitive = COALESCE($5, sensitive), source = 'user', updated_at = $6
                WHERE id = $1 AND user_id = $2 RETURNING id, question_key, label_seen, sensitive, source, updated_at`,
              [id, ctx.userId, sealed, v.labelSeen ?? null, v.sensitive ?? null, ctx.now()],
            )
          ).rows[0]
        : (
            await c.query(
              `INSERT INTO answer_bank (id, user_id, question_key, label_seen, answer_enc, sensitive, source, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'user', $7, $7) RETURNING id, question_key, label_seen, sensitive, source, updated_at`,
              [id, ctx.userId, v.questionKey, v.labelSeen ?? null, sealed, v.sensitive ?? false, ctx.now()],
            )
          ).rows[0];
      if (!r) throw notFound();
      return { id: r.id, questionKey: r.question_key, labelSeen: r.label_seen ?? null, sensitive: r.sensitive === true, source: r.source, answer: v.answer, updatedAt: (r.updated_at as Date).toISOString() };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

export async function deleteAnswer(ctx: ServiceCtx, input: unknown): Promise<{ deleted: true }> {
  const { id } = parseInput(AnswerIdInput, input);
  try {
    return await withUserTx(ctx, async (c) => {
      const r = await c.query('DELETE FROM answer_bank WHERE id = $1 AND user_id = $2', [id, ctx.userId]);
      if (r.rowCount !== 1) throw notFound();
      return { deleted: true as const };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}
