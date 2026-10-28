import { answerAad, collegeAad, parsedAad } from './aad';
import type { ServiceCtx } from './ctx';
import { withUserTx } from './db';
import { mapPgError, notFound } from './errors';
import { openJson } from './seal';
import { getEligibility } from './eligibility';

export interface Me {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  createdAt: string;
}

export async function getMe(ctx: ServiceCtx): Promise<Me> {
  try {
    return await withUserTx(ctx, async (c) => {
      const r = (await c.query('SELECT id, email, display_name, role, created_at FROM users WHERE id = $1', [ctx.userId])).rows[0];
      if (!r) throw notFound();
      return { id: r.id, email: String(r.email), displayName: r.display_name ?? null, role: r.role, createdAt: (r.created_at as Date).toISOString() };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

/** Everything held about the signed-in person, opened. Files are not included; download them one by one (audited). */
export async function exportMe(ctx: ServiceCtx): Promise<Record<string, unknown>> {
  const me = await getMe(ctx);
  const eligibility = await getEligibility(ctx);
  try {
    return await withUserTx(ctx, async (c) => {
      const q = async (sql: string) => (await c.query(sql, [ctx.userId])).rows;
      const profile = (await q('SELECT * FROM profiles WHERE user_id = $1'))[0] ?? null;
      if (profile) {
        const enc = profile.college_text_enc as Buffer | null;
        profile.college_text = enc ? await openJson(ctx, collegeAad(ctx.userId), enc) : null;
        delete profile.college_text_enc;
      }
      const resumes = [];
      for (const r of await q('SELECT * FROM resumes WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at, id')) {
        const parsed = r.parsed_enc ? await openJson(ctx, parsedAad(ctx.userId, r.id), r.parsed_enc) : null;
        delete r.parsed_enc;
        delete r.blob_key;
        delete r.file_hmac;
        resumes.push({ ...r, parsed });
      }
      const answers = [];
      for (const a of await q('SELECT id, question_key, label_seen, answer_enc, sensitive, source FROM answer_bank WHERE user_id = $1 ORDER BY question_key')) {
        answers.push({ questionKey: a.question_key, labelSeen: a.label_seen, sensitive: a.sensitive, source: a.source, answer: await openJson(ctx, answerAad(ctx.userId, a.id), a.answer_enc) });
      }
      return {
        exportedAt: ctx.now().toISOString(),
        user: me,
        profile,
        eligibility,
        workAuthorizations: await q('SELECT country, status FROM work_authorizations WHERE user_id = $1 ORDER BY country'),
        resumes,
        answerBank: answers,
        consents: await q('SELECT kind, granted, doc_version, at FROM consents WHERE user_id = $1 ORDER BY at, id'),
        fileAccessLog: await q('SELECT action, at FROM file_access_log WHERE user_id = $1 ORDER BY at, id'),
      };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}
