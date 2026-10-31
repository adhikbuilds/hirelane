import type { ServiceCtx } from '../ctx';
import { withUserTx, type UserClient } from '../db';
import { mapPgError, notFound } from '../errors';
import { openJson } from '../seal';
import { parseInput } from '../schema';
import { readAddressIn } from './address';
import { applyAnswerAad, inboundAad } from './aad';
import { ApplicationIdInput, ListApplicationsInput } from './inputs';

export const FALLBACK_MESSAGE = 'Finish on their site';

export interface ApplicationSummary {
  id: string;
  status: string;
  company: string;
  title: string;
  platform: string;
  undoUntil: string;
  canUndo: boolean;
  blockedReason: string | null;
  fallback: { message: string; url: string } | null;
  needsYouCount: number;
  lastReply: string | null;
  createdAt: string;
  submittedAt: string | null;
}

const SUMMARY_SQL = `SELECT a.id, a.status, a.company_name, a.job_title, a.platform, a.apply_url, a.undo_until, a.blocked_reason,
       a.created_at, a.submitted_at, (a.status = 'ready' AND a.undo_until > now()) AS can_undo,
       (SELECT count(*)::int FROM application_answers x WHERE x.application_id = a.id AND x.needs_you) AS needs_you,
       (SELECT m.kind FROM inbound_messages m WHERE m.application_id = a.id ORDER BY m.received_at DESC LIMIT 1) AS last_reply
  FROM applications a`;

const summaryOf = (r: Record<string, any>): ApplicationSummary => ({
  id: r.id,
  status: r.status,
  company: r.company_name,
  title: r.job_title,
  platform: r.platform,
  undoUntil: (r.undo_until as Date).toISOString(),
  canUndo: r.can_undo === true,
  blockedReason: r.blocked_reason ?? null,
  // The link comes from ingested postings; only an https link is ever handed out.
  fallback: r.status === 'blocked_fallback' && /^https:\/\//i.test(String(r.apply_url)) ? { message: FALLBACK_MESSAGE, url: r.apply_url } : null,
  needsYouCount: Number(r.needs_you),
  lastReply: r.last_reply ?? null,
  createdAt: (r.created_at as Date).toISOString(),
  submittedAt: r.submitted_at ? (r.submitted_at as Date).toISOString() : null,
});

export async function listApplications(ctx: ServiceCtx, input: unknown = {}): Promise<{ applications: ApplicationSummary[] }> {
  const { status, limit } = parseInput(ListApplicationsInput, input ?? {});
  try {
    return await withUserTx(ctx, async (c) => {
      const rows = (
        await c.query(`${SUMMARY_SQL} WHERE a.user_id = $1 AND ($2::text IS NULL OR a.status = $2) ORDER BY a.created_at DESC, a.id LIMIT $3`, [ctx.userId, status ?? null, limit ?? 50])
      ).rows;
      return { applications: rows.map(summaryOf) };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

export interface InboundView {
  id: string;
  applicationId: string | null;
  employer: string;
  kind: string;
  matchedBy: string;
  subject: string;
  excerpt: string;
  receivedAt: string;
}

export async function inboundViews(ctx: ServiceCtx, c: UserClient, where: string, params: unknown[]): Promise<InboundView[]> {
  const rows = (
    await c.query(`SELECT id, application_id, employer, kind, matched_by, excerpt_enc, received_at FROM inbound_messages WHERE user_id = $1 ${where} ORDER BY received_at DESC, id LIMIT 200`, [ctx.userId, ...params])
  ).rows;
  const out: InboundView[] = [];
  for (const r of rows) {
    const body = (await openJson(ctx, inboundAad(ctx.userId, r.id), r.excerpt_enc)) as { subject?: unknown; excerpt?: unknown };
    out.push({
      id: r.id,
      applicationId: r.application_id ?? null,
      employer: r.employer,
      kind: r.kind,
      matchedBy: r.matched_by,
      subject: typeof body.subject === 'string' ? body.subject : '',
      excerpt: typeof body.excerpt === 'string' ? body.excerpt : '',
      receivedAt: (r.received_at as Date).toISOString(),
    });
  }
  return out;
}

export async function getApplication(ctx: ServiceCtx, input: unknown) {
  const { id } = parseInput(ApplicationIdInput, input);
  try {
    return await withUserTx(ctx, async (c) => {
      const row = (await c.query(`${SUMMARY_SQL} WHERE a.id = $1 AND a.user_id = $2`, [id, ctx.userId])).rows[0];
      if (!row) throw notFound();
      const answers = [];
      for (const a of (await c.query('SELECT id, field_id, question_key, label, required, needs_you, reason, answer_enc, evidence_sources FROM application_answers WHERE application_id = $1 AND user_id = $2 ORDER BY needs_you DESC, label, id', [id, ctx.userId])).rows) {
        answers.push({
          fieldId: a.field_id as string,
          questionKey: (a.question_key as string | null) ?? null,
          label: a.label as string,
          required: a.required === true,
          needsYou: a.needs_you === true,
          reason: (a.reason as string | null) ?? null,
          answer: a.answer_enc ? ((await openJson(ctx, applyAnswerAad(ctx.userId, a.id), a.answer_enc)) as string) : null,
          sources: a.evidence_sources as string[],
        });
      }
      const rc = (await c.query('SELECT answers_hash, resume_id, resume_version, platform, result_code, sent, http_status, created_at FROM receipts WHERE application_id = $1 AND user_id = $2', [id, ctx.userId])).rows[0];
      const addr = await readAddressIn(c, ctx.userId);
      return {
        application: summaryOf(row),
        applyAddress: addr?.address ?? null,
        answers,
        receipt: rc
          ? {
              answersHash: rc.answers_hash as string,
              resumeId: (rc.resume_id as string | null) ?? null,
              resumeVersion: rc.resume_version == null ? null : Number(rc.resume_version),
              platform: rc.platform as string,
              resultCode: rc.result_code as string,
              sent: rc.sent === true,
              httpStatus: rc.http_status == null ? null : Number(rc.http_status),
              at: (rc.created_at as Date).toISOString(),
            }
          : null,
        messages: await inboundViews(ctx, c, 'AND application_id = $2', [id]),
      };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}
