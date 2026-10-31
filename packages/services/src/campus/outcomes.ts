import { open, seal } from '@hirelane/vault';
import type { ServiceCtx } from '../ctx';
import { withUserTx } from '../db';
import { mapPgError, notFound, ServiceError } from '../errors';
import { parseInput } from '../schema';
import { CampusIdInput, OutcomeInput } from './inputs';
import { membershipIn } from './membership';
import { callIn } from './rpc';
import { orNotFound, resolveCampus, staffTx } from './tpo';
import { OutcomesListInput } from './inputs';

export const MAX_LETTER_BYTES = 2 * 1024 * 1024;
export const MAX_OUTCOMES_PER_STUDENT = 50;
/** Binds a sealed letter to its owner and row: a copy under another user or row fails to open. */
export const outcomeLetterAad = (userId: string, id: string): string => `outcome-letter:${userId}:${id}`;

export interface MyOutcome {
  id: string;
  kind: 'interview' | 'offer';
  employer: string;
  roleTitle: string | null;
  packageLpa: number | null;
  verification: 'student_reported' | 'tpo_verified';
  hasLetter: boolean;
  createdAt: string;
}
const COLS = 'id, kind, employer, role_title, package_lpa, verification, (letter_enc IS NOT NULL) AS has_letter, created_at';
const toMine = (r: Record<string, any>): MyOutcome => ({
  id: r.id,
  kind: r.kind,
  employer: r.employer,
  roleTitle: r.role_title ?? null,
  packageLpa: r.package_lpa == null ? null : Number(r.package_lpa),
  verification: r.verification,
  hasLetter: r.has_letter === true,
  createdAt: (r.created_at as Date).toISOString(),
});

/** "I got an interview / an offer." Student-reported until a TPO verifies it. The student's campus and cohort come from their membership. */
export async function reportOutcome(ctx: ServiceCtx, input: unknown): Promise<MyOutcome> {
  const i = parseInput(OutcomeInput, input);
  try {
    return await withUserTx(ctx, async (c) => {
      const m = await membershipIn(c, ctx.userId);
      if (!m) throw new ServiceError('not_in_campus', 409);
      const n = (await c.query('SELECT count(*)::int AS n FROM outcomes WHERE user_id = $1', [ctx.userId])).rows[0].n as number;
      if (n >= MAX_OUTCOMES_PER_STUDENT) throw new ServiceError('too_many_outcomes', 409);
      const r = await c.query(
        `INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer, role_title, package_lpa) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLS}`,
        [ctx.userId, m.campus.id, m.cohort.id, i.kind, i.employer, i.roleTitle ?? null, i.packageLpa ?? null],
      );
      return toMine(r.rows[0]);
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

export async function listMyOutcomes(ctx: ServiceCtx): Promise<{ outcomes: MyOutcome[] }> {
  try {
    const rows = await withUserTx(ctx, async (c) => (await c.query(`SELECT ${COLS} FROM outcomes ORDER BY created_at DESC, id`)).rows);
    return { outcomes: rows.map(toMine) };
  } catch (e) {
    throw mapPgError(e);
  }
}

/** Optional offer letter: a PDF, at most 2 MB, sealed with the vault before it is stored. A TPO sees it only with the offer_letter_tpo consent. */
export async function attachLetter(ctx: ServiceCtx, input: unknown, bytes: Buffer): Promise<{ id: string; hasLetter: true }> {
  const { id } = parseInput(CampusIdInput, input);
  if (bytes.length === 0) throw new ServiceError('empty_file', 400);
  if (bytes.length > MAX_LETTER_BYTES) throw new ServiceError('file_too_large', 413);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ServiceError('bad_file_type', 415);
  const sealed = await seal(ctx.keys, bytes, { aad: outcomeLetterAad(ctx.userId, id) });
  try {
    const n = await withUserTx(ctx, async (c) => (await c.query("UPDATE outcomes SET letter_enc = $3, letter_mime = 'application/pdf', updated_at = $4 WHERE id = $1 AND user_id = $2", [id, ctx.userId, sealed, ctx.now()])).rowCount);
    if (!n) throw notFound(); // not yours, missing, or already verified (locked)
  } catch (e) {
    throw mapPgError(e);
  }
  return { id, hasLetter: true };
}

/** TPO: the outcomes of students at share level outcomes or full. Each student returned is logged, and the log is visible to them. */
export async function listOutcomes(ctx: ServiceCtx, input: unknown = {}) {
  const i = parseInput(OutcomesListInput, input);
  return staffTx(ctx, async (c) => {
    const campus = await resolveCampus(c, i.campusId);
    return { outcomes: orNotFound(await callIn<unknown[] | null>(c, 'tpo_list_outcomes', [campus, i.cohortId ?? null])) };
  });
}

export async function verifyOutcome(ctx: ServiceCtx, input: unknown): Promise<{ id: string; verification: 'tpo_verified' }> {
  const { id } = parseInput(CampusIdInput, input);
  return staffTx(ctx, async (c) => orNotFound(await callIn<{ id: string; verification: 'tpo_verified' } | null>(c, 'tpo_verify_outcome', [id])));
}

/** TPO: the sealed letter, opened. Only with the student's share level and consent; the read is logged for the student. */
export async function outcomeLetter(ctx: ServiceCtx, input: unknown): Promise<{ bytes: Buffer; mime: string }> {
  const { id } = parseInput(CampusIdInput, input);
  const r = await staffTx(ctx, async (c) => orNotFound(await callIn<{ id: string; userId: string; mime: string; letterB64: string } | null>(c, 'tpo_outcome_letter', [id])));
  try {
    const bytes = await open(ctx.keys, Buffer.from(r.letterB64, 'base64'), { aad: outcomeLetterAad(r.userId, r.id) });
    return { bytes, mime: r.mime };
  } catch {
    throw new ServiceError('unreadable_record', 500);
  }
}
