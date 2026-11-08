/**
 * Shared plumbing for the apply tasks (apply:submit, apply:sweep). Right swipe = applied, fixture-only until the owner runs a pilot.
 *
 * CONTRACTS the services layer must match (packages/services/src/apply/aad.ts; a test on each side pins the literals):
 *   - application_answers.answer_enc AAD .... `applyans:<user id>:<answer row id>`
 *   - application_answers.evidence_enc AAD .. `applyev:<user id>:<answer row id>`
 *   - application_answers.suggestion_enc AAD  `applysug:<user id>:<answer row id>`  (sealed JSON string: a composed draft, needs_you only)
 *   - inbound_messages.excerpt_enc AAD ...... `inbound:<user id>:<message row id>`  (sealed JSON { subject, excerpt })
 *   - answer_bank answers ................... `answer:<user id>:<row id>` (services/aad.ts answerAad), sealed JSON string
 * Payloads are `{ applicationId }` only. Logs carry ids and codes only: never names, answers, URLs or error messages.
 */
import { createHash, randomUUID } from 'node:crypto';
import { applyAddressOf } from '../../../../packages/agent/src/apply-address';
import { adminRun, defaultVault, type Queryable, type ResumeVault, type Run } from './resume-common';

export const applyAnswerAad = (userId: string, id: string): string => `applyans:${userId}:${id}`;
export const applyEvidenceAad = (userId: string, id: string): string => `applyev:${userId}:${id}`;
export const applySuggestionAad = (userId: string, id: string): string => `applysug:${userId}:${id}`;
export const inboundAad = (userId: string, id: string): string => `inbound:${userId}:${id}`;
export const bankAad = (userId: string, id: string): string => `answer:${userId}:${id}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Payload must be exactly `{ applicationId: <uuid> }`. Throws a message with no payload content. */
export function parseApplyPayload(payload: unknown): string {
  const id = (payload as { applicationId?: unknown } | null)?.applicationId;
  if (typeof id !== 'string' || !UUID.test(id) || Object.keys(payload as object).length !== 1) throw new Error('apply task: invalid payload');
  return id.toLowerCase();
}

export const submitJobKey = (applicationId: string): string => `apply:submit:${applicationId}`;

export type PlatformName = 'greenhouse' | 'lever' | 'ashby';
export interface ClaimedApplication {
  id: string;
  userId: string;
  platform: PlatformName;
  applyUrl: string;
  resumeId: string | null;
  jobId: string | null;
  companyName: string;
  jobTitle: string;
  /** Attempts today in the student's time zone, this one included. */
  attemptsToday: number;
  dailyCap: number;
}
export type ClaimResult = { kind: 'claimed'; app: ClaimedApplication } | { kind: 'too_early'; undoUntil: Date } | { kind: 'gone' };

export interface AnswerRowWrite {
  fieldId: string;
  label: string;
  questionKey: string | null;
  required: boolean;
  needsYou: boolean;
  reason: string | null;
  answer: string | null;
  evidence: { source: string; field: string }[];
  /** A draft the engine composed (free-text template). Stored sealed on a needs_you row; never sent. */
  suggestion?: string | null;
}
export interface ReceiptWrite {
  answersHash: string;
  resumeId: string | null;
  resumeVersion: number | null;
  platform: PlatformName;
  resultCode: string;
  sent: boolean;
  httpStatus: number | null;
}
export interface FinishWrite {
  state: 'submitted' | 'blocked_fallback' | 'failed';
  reason: string | null;
  fallbackNote: string | null;
  answers: AnswerRowWrite[];
  receipt: ReceiptWrite;
}

export interface StudentFacts {
  fullName: string | null;
  /** The student's Hirelane apply address (handle@domain), or null. It is the ONLY email a form ever receives, so replies come back to us. */
  applyAddress: string | null;
  autoApply: boolean;
  eligibility: Record<string, unknown> | null;
  workAuthorizations: { country: string; status: 'citizen' | 'permanent' | 'visa_held' | 'needs_sponsorship' }[];
  bank: { questionKey: string; answer: string; source: 'user' | 'resume' }[];
  campusRule: unknown;
  /** campuses.name, to find the university row. Optional so older facts type-check; absent means no row. */
  campusName?: string | null;
  countries: string[];
  resumeConfirmed: boolean;
  skills: string[];
  /** resumes.sensitive_kinds of the resume that would be sent (Aadhaar, PAN, DOB, caste, religion, photo ...). Any entry blocks auto-submit. */
  sensitiveKinds: string[];
}
export interface ResumeBlob {
  id: string;
  version: number;
  mime: string;
  bytes: Uint8Array;
}

export interface ApplyRepo {
  claim(id: string): Promise<ClaimResult>;
  platformEnabled(platform: PlatformName): Promise<boolean>;
  studentFacts(app: ClaimedApplication): Promise<StudentFacts>;
  loadResume(app: ClaimedApplication): Promise<ResumeBlob | null>;
  finish(app: ClaimedApplication, w: FinishWrite): Promise<boolean>;
  /** Applications ready and past their window for a while (their submit job was lost), and ones stuck submitting. */
  sweepable(now: Date): Promise<{ lostReady: string[]; stuck: string[] }>;
  failStuck(id: string): Promise<boolean>;
  /**
   * Puts an over-cap application back to `ready` with its window opening at the student's next local midnight, and returns that
   * moment. The swipe is kept (the student can still undo it until then), nothing is sent.
   */
  requeueForTomorrow(app: ClaimedApplication): Promise<Date>;
}

const BATCH = 200;
const KOLKATA = 'Asia/Kolkata';

const buf = (v: unknown): Buffer => (Buffer.isBuffer(v) ? v : Buffer.from(v as Uint8Array));
const num = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);

/** eligibility_profiles row (snake_case, numerics as strings from pg) to the engine's input. Confirmed by construction. */
export function eligibilityFromRow(r: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!r) return null;
  const out: Record<string, unknown> = { confirmed: true };
  for (const k of ['pct_10', 'pct_secondary', 'grad_score', 'grad_pct_equiv', 'grad_scale', 'active_backlogs', 'backlog_history', 'gap_years', 'passout_year', 'admission_year']) {
    const n = num(r[k]);
    if (n !== undefined) out[k] = n;
  }
  for (const k of ['board_10', 'secondary_kind', 'board_secondary', 'degree', 'branch_code', 'branch_raw', 'grad_conversion', 'grad_is_final', 'lateral_entry', 'university_scheme']) {
    if (r[k] !== null && r[k] !== undefined) out[k] = r[k];
  }
  return out;
}

export function createApplyRepo(run: Run = adminRun, vault: ResumeVault = defaultVault()): ApplyRepo {
  const tx = async <T>(c: Queryable, fn: () => Promise<T>): Promise<T> => {
    await c.query('BEGIN');
    try {
      const out = await fn();
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  };
  return {
    claim: (id) =>
      run((c) =>
        tx(c, async () => {
          const a = (await c.query('SELECT user_id FROM applications WHERE id = $1', [id])).rows[0];
          if (!a) return { kind: 'gone' } as const;
          // One claim at a time per student, so the daily count below cannot be raced past the cap.
          await c.query("SELECT pg_advisory_xact_lock(hashtextextended('apply_claim:' || $1::text, 0))", [a['user_id']]);
          // The one atomic step: only a ready application whose undo window has closed can be claimed. An undo racing this
          // statement has exactly one winner (row lock + the guard in the transition trigger).
          const r = await c.query(
            `UPDATE applications SET status = 'submitting'
              WHERE id = $1 AND status = 'ready' AND undo_until <= now()
          RETURNING id, user_id, platform, apply_url, resume_id, job_id, company_name, job_title`,
            [id],
          );
          if (r.rowCount === 0) {
            const s = (await c.query('SELECT status, undo_until FROM applications WHERE id = $1', [id])).rows[0];
            return s && s['status'] === 'ready' ? ({ kind: 'too_early', undoUntil: s['undo_until'] as Date } as const) : ({ kind: 'gone' } as const);
          }
          const row = r.rows[0]!;
          const userId = String(row['user_id']);
          const info = (
            await c.query(
              `SELECT (SELECT CASE WHEN p.tz IN (SELECT name FROM pg_timezone_names) THEN p.tz ELSE $2 END FROM profiles p WHERE p.user_id = $1) AS tz,
                      (SELECT daily_cap FROM apply_addresses WHERE user_id = $1) AS cap`,
              [userId, KOLKATA],
            )
          ).rows[0]!;
          const tz = typeof info['tz'] === 'string' ? info['tz'] : KOLKATA;
          const n = (
            await c.query(
              // Decision 2026-10-31 (docs/apply.md "Open before pilot" 2): a blocked attempt (CAPTCHA, login, needs_you, ...) is an attempt
              // on the employer's site like any other, so it counts toward the daily cap.
              `SELECT count(*)::int AS n FROM applications
                WHERE user_id = $1 AND status IN ('submitting', 'submitted', 'failed', 'blocked_fallback')
                  AND claimed_at >= (date_trunc('day', now() AT TIME ZONE $2::text) AT TIME ZONE $2::text)`,
              [userId, tz],
            )
          ).rows[0]!;
          return {
            kind: 'claimed',
            app: {
              id: String(row['id']),
              userId,
              platform: row['platform'] as PlatformName,
              applyUrl: String(row['apply_url']),
              resumeId: row['resume_id'] ? String(row['resume_id']) : null,
              jobId: row['job_id'] ? String(row['job_id']) : null,
              companyName: String(row['company_name']),
              jobTitle: String(row['job_title']),
              attemptsToday: Number(n['n']),
              dailyCap: info['cap'] === null || info['cap'] === undefined ? 20 : Number(info['cap']),
            },
          } as const;
        }),
      ),

    // A missing row fails closed: no switch row means no submitting.
    platformEnabled: (platform) =>
      run(async (c) => {
        const r = (await c.query('SELECT enabled FROM platform_switches WHERE platform = $1', [platform])).rows[0];
        return r?.['enabled'] === true;
      }),

    studentFacts: (app) =>
      run(async (c) => {
        const q = async (sql: string, p: unknown[]) => (await c.query(sql, p)).rows;
        const u = (await q('SELECT display_name FROM users WHERE id = $1', [app.userId]))[0];
        const addr = (await q('SELECT handle, domain, reply_handle FROM apply_addresses WHERE user_id = $1', [app.userId]))[0];
        const consent = (await q("SELECT granted FROM consents WHERE user_id = $1 AND kind = 'auto_apply' ORDER BY at DESC, id DESC LIMIT 1", [app.userId]))[0];
        const bank: StudentFacts['bank'] = [];
        for (const r of await q('SELECT id, question_key, answer_enc, source FROM answer_bank WHERE user_id = $1 AND NOT sensitive ORDER BY question_key', [app.userId])) {
          const v = await vault.openJson(buf(r['answer_enc']), bankAad(app.userId, String(r['id'])));
          if (typeof v === 'string') bank.push({ questionKey: String(r['question_key']), answer: v, source: r['source'] === 'resume' ? 'resume' : 'user' });
        }
        const rule = (await q('SELECT c.cgpa_rule, c.name FROM cohort_members m JOIN campuses c ON c.id = m.campus_id WHERE m.user_id = $1', [app.userId]))[0];
        const countries = app.jobId ? ((await q('SELECT countries FROM jobs WHERE id = $1', [app.jobId]))[0]?.['countries'] as string[] | undefined) ?? [] : [];
        const resumeId = app.resumeId ?? ((await q('SELECT id FROM resumes WHERE user_id = $1 AND is_default AND deleted_at IS NULL', [app.userId]))[0]?.['id'] as string | undefined) ?? null;
        const resume = resumeId ? (
              await q(
                // sensitive_kinds are written on the ROOT row by the extractor; confirmed versions carry the default '{}'. Read the root's, and require it live.
                `SELECT r.parse_status, r.skills, COALESCE(p.sensitive_kinds, r.sensitive_kinds) AS sensitive_kinds
                   FROM resumes r LEFT JOIN resumes p ON p.id = r.parent_id AND p.user_id = r.user_id
                  WHERE r.id = $1 AND r.user_id = $2 AND r.deleted_at IS NULL AND r.purged_at IS NULL
                    AND (r.parent_id IS NULL OR (p.deleted_at IS NULL AND p.purged_at IS NULL))`,
                [resumeId, app.userId],
              )
            )[0] : undefined;
        return {
          fullName: (u?.['display_name'] as string | null) ?? null,
          applyAddress: addr ? applyAddressOf({ handle: String(addr['handle']), replyHandle: String(addr['reply_handle']), domain: String(addr['domain']) }) : null,
          autoApply: consent?.['granted'] === true,
          eligibility: eligibilityFromRow((await q('SELECT * FROM eligibility_profiles WHERE user_id = $1', [app.userId]))[0]),
          workAuthorizations: (await q('SELECT country, status FROM work_authorizations WHERE user_id = $1', [app.userId])).map((r) => ({
            country: String(r['country']),
            status: r['status'] as StudentFacts['workAuthorizations'][number]['status'],
          })),
          bank,
          campusRule: rule?.['cgpa_rule'] ?? null,
          campusName: typeof rule?.['name'] === 'string' ? (rule['name'] as string) : null,
          countries,
          resumeConfirmed: resume?.['parse_status'] === 'confirmed',
          skills: (resume?.['skills'] as string[] | undefined) ?? [],
          sensitiveKinds: (resume?.['sensitive_kinds'] as string[] | undefined) ?? [],
        };
      }),

    loadResume: (app) =>
      run(async (c) => {
        const r = (
          await c.query(
            `SELECT id, blob_key, mime, parsed_version FROM resumes
              WHERE user_id = $1 AND deleted_at IS NULL AND purged_at IS NULL AND (id = $2 OR ($2::uuid IS NULL AND is_default))
              ORDER BY (id = $2) DESC NULLS LAST LIMIT 1`,
            [app.userId, app.resumeId],
          )
        ).rows[0];
        if (!r) return null;
        const key = String(r['blob_key']);
        const blobId = key.split('/').pop() ?? '';
        const bytes = await vault.getBlob(key, `resumes:${blobId}:${app.userId}:file`);
        return { id: String(r['id']), version: Number(r['parsed_version']), mime: String(r['mime']), bytes };
      }),

    finish: (app, w) =>
      run((c) =>
        tx(c, async () => {
          // A re-armed application is attempted again: the earlier blocked attempt's unsent receipt and answers are replaced.
          await c.query('DELETE FROM application_answers WHERE application_id = $1', [app.id]);
          await c.query('DELETE FROM receipts WHERE application_id = $1 AND NOT sent', [app.id]);
          const seen = new Set<string>();
          for (const a of w.answers) {
            // One row per form field: a form that repeats a field id must not make the whole record fail after the send.
            const fid = a.fieldId.slice(0, 200);
            if (seen.has(fid)) continue;
            seen.add(fid);
            const rowId = randomUUID();
            const filled = !a.needsYou;
            await c.query(
              `INSERT INTO application_answers (id, application_id, user_id, field_id, label, question_key, required, needs_you, reason, answer_enc, evidence_enc, evidence_sources, suggestion_enc)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [
                rowId,
                app.id,
                app.userId,
                a.fieldId.slice(0, 200),
                a.label.slice(0, 300),
                a.questionKey && /^[a-z0-9_.:-]{1,80}$/.test(a.questionKey) ? a.questionKey : null,
                a.required,
                a.needsYou,
                a.reason ? a.reason.slice(0, 300) : null,
                filled ? await vault.sealJson(a.answer, applyAnswerAad(app.userId, rowId)) : null,
                filled ? await vault.sealJson(a.evidence, applyEvidenceAad(app.userId, rowId)) : null,
                filled ? a.evidence.map((e) => `${e.source}:${e.field}`.slice(0, 120)) : [],
                !filled && a.suggestion ? await vault.sealJson(a.suggestion.slice(0, 2000), applySuggestionAad(app.userId, rowId)) : null,
              ],
            );
          }
          const rc = w.receipt;
          await c.query(
            `INSERT INTO receipts (application_id, user_id, answers_hash, resume_id, resume_version, platform, result_code, sent, http_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [app.id, app.userId, rc.answersHash, rc.resumeId, rc.resumeVersion, rc.platform, rc.resultCode, rc.sent, rc.httpStatus],
          );
          const r = await c.query(
            `UPDATE applications SET status = $2, blocked_reason = $3, fallback_note = $4 WHERE id = $1 AND status = 'submitting'`,
            [app.id, w.state, w.reason, w.fallbackNote],
          );
          if (r.rowCount !== 1) throw new Error('apply: application is no longer submitting');
          return true;
        }),
      ),

    sweepable: (now) =>
      run(async (c) => {
        const lost = await c.query(
          `SELECT id FROM applications WHERE status = 'ready' AND undo_until < $1::timestamptz - interval '1 minute' ORDER BY undo_until LIMIT ${BATCH}`,
          [now],
        );
        const stuck = await c.query(
          `SELECT id FROM applications WHERE status = 'submitting' AND claimed_at < $1::timestamptz - interval '15 minutes' ORDER BY claimed_at LIMIT ${BATCH}`,
          [now],
        );
        return { lostReady: lost.rows.map((r) => String(r['id'])), stuck: stuck.rows.map((r) => String(r['id'])) };
      }),

    requeueForTomorrow: (app) =>
      run((c) =>
        tx(c, async () => {
          const tz = (
            await c.query(`SELECT CASE WHEN p.tz IN (SELECT name FROM pg_timezone_names) THEN p.tz ELSE $2 END AS tz FROM (SELECT $1::uuid AS id) x LEFT JOIN profiles p ON p.user_id = x.id`, [app.userId, KOLKATA])
          ).rows[0]!['tz'] as string;
          const back = await c.query("UPDATE applications SET status = 'ready' WHERE id = $1 AND status = 'submitting' RETURNING id", [app.id]);
          if (back.rowCount !== 1) throw new Error('apply: application is no longer submitting');
          const at = (
            await c.query(
              `UPDATE applications SET undo_until = (date_trunc('day', now() AT TIME ZONE $2::text) + interval '1 day') AT TIME ZONE $2::text
                WHERE id = $1 RETURNING undo_until`,
              [app.id, tz],
            )
          ).rows[0]!['undo_until'] as Date;
          return at;
        }),
      ),

    failStuck: (id) =>
      run(async (c) => {
        const r = await c.query("UPDATE applications SET status = 'failed', blocked_reason = 'stuck' WHERE id = $1 AND status = 'submitting'", [id]);
        return r.rowCount === 1;
      }),
  };
}

/**
 * Bank key for a question the engine cannot classify: `q:` plus 16 hex characters of the hash of the normalised label. The
 * student answers such a question once (PUT /api/v1/apply/answers with this key, shown on the application detail) and it is
 * reused for every form that asks it the same way. Matches ^[a-z0-9_.:-]{1,80}$ (answer_bank.question_key).
 */
export function bankKeyForLabel(label: string): string {
  const norm = label.normalize('NFKC').toLowerCase().replace(/[*✱]/g, ' ').replace(/\(\s*(?:optional|required)\s*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return `q:${createHash('sha256').update(norm).digest('hex').slice(0, 16)}`;
}
