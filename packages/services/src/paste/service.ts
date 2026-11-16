import type { ServiceCtx } from '../ctx';
import { withUserTx } from '../db';
import { mapPgError } from '../errors';
import { loadStudentContext } from '../picks/fit';
import { parseInput } from '../schema';
import { assessPaste } from './assess';
import { PasteInput, type PasteResult } from './types';

/**
 * POST /api/v1/paste. The signed-in student's own profile and resume skills are read (read only); the pasted text is judged
 * and the answer returned. Nothing is written: not the text, not the result. A job is kept only if the student later saves it
 * through the tracker.
 */
export async function checkPastedJob(ctx: ServiceCtx, input: unknown): Promise<PasteResult> {
  const { text, url } = parseInput(PasteInput, input);
  let student;
  try {
    student = await withUserTx(ctx, (c) => loadStudentContext(c, ctx.userId));
  } catch (e) {
    throw mapPgError(e);
  }
  return assessPaste(text, { profile: student.profile, cgpaRule: student.cgpaRule, universityRule: student.universityRule, fit: student.fit, now: ctx.now(), url: url ?? null });
}
