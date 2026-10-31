import { applyAddressOf } from '@hirelane/agent';
import { answerAad, collegeAad, parsedAad } from './aad';
import type { ServiceCtx } from './ctx';
import { withUserTx } from './db';
import { mapPgError, notFound } from './errors';
import { openJson } from './seal';
import { getEligibility } from './eligibility';
import { applyAnswerAad, applyEvidenceAad, applySuggestionAad, inboundAad } from './apply/aad';

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
      const applications = [];
      for (const a of await q('SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at, id')) {
        const answers = [];
        for (const r of (await c.query('SELECT * FROM application_answers WHERE application_id = $1 AND user_id = $2 ORDER BY created_at, id', [a.id, ctx.userId])).rows) {
          answers.push({
            fieldId: r.field_id,
            label: r.label,
            questionKey: r.question_key,
            required: r.required,
            needsYou: r.needs_you,
            reason: r.reason,
            evidenceSources: r.evidence_sources,
            answer: r.answer_enc ? await openJson(ctx, applyAnswerAad(ctx.userId, r.id), r.answer_enc) : null,
            evidence: r.evidence_enc ? await openJson(ctx, applyEvidenceAad(ctx.userId, r.id), r.evidence_enc) : null,
            suggestion: r.suggestion_enc ? await openJson(ctx, applySuggestionAad(ctx.userId, r.id), r.suggestion_enc) : null,
          });
        }
        const receipts = (await c.query('SELECT * FROM receipts WHERE application_id = $1 AND user_id = $2 ORDER BY created_at, id', [a.id, ctx.userId])).rows;
        applications.push({ ...a, answers, receipts });
      }
      const applyAddr = (await q('SELECT handle, domain, reply_handle, daily_cap, created_at FROM apply_addresses WHERE user_id = $1'))[0];
      const inboundMessages = [];
      for (const m of await q('SELECT * FROM inbound_messages WHERE user_id = $1 ORDER BY received_at, id')) {
        const body = m.excerpt_enc ? ((await openJson(ctx, inboundAad(ctx.userId, m.id), m.excerpt_enc)) as { subject?: unknown; excerpt?: unknown }) : {};
        delete m.excerpt_enc;
        inboundMessages.push({ ...m, subject: body.subject ?? null, excerpt: body.excerpt ?? null });
      }
      // Sealed letters are files: fetched one by one from the outcome letter route, so the bytes are left out here.
      const outcomes = (await q('SELECT * FROM outcomes WHERE user_id = $1 ORDER BY created_at, id')).map((o) => {
        const hasLetter = o.letter_enc != null;
        delete o.letter_enc;
        return { ...o, hasLetter };
      });
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
        applications,
        applyAddress: applyAddr ? { address: applyAddressOf({ handle: applyAddr.handle, replyHandle: applyAddr.reply_handle, domain: applyAddr.domain }), dailyCap: applyAddr.daily_cap, createdAt: applyAddr.created_at } : null,
        inboundMessages,
        notifications: await q('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at, id'),
        notificationPrefs: await q('SELECT kind, email, updated_at FROM notification_prefs WHERE user_id = $1 ORDER BY kind'),
        outcomes,
        driveChecks: await q('SELECT drive_id, verdict, checked_at FROM drive_checks WHERE user_id = $1 ORDER BY checked_at, drive_id'),
        cohortMemberships: await q('SELECT campus_id, cohort_id, share_level, verified_via, verified_at, placed, joined_at FROM cohort_members WHERE user_id = $1 ORDER BY joined_at, id'),
        // Who at the college read this student's data (staff names are not shown).
        collegeAccessLog: await q('SELECT campus_id, action, at FROM tpo_access_log WHERE subject_user_id = $1 ORDER BY at, id'),
      };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}
