import { randomInt, randomUUID } from 'node:crypto';
import { hmac } from '@hirelane/vault';
import type { ServiceCtx } from '../ctx';
import { withUserTx, type UserClient } from '../db';
import { mapPgError, ServiceError } from '../errors';
import { parseInput } from '../schema';
import { campusCodeHmac, domainOf, mailboxHmac, normalizeCampusCode, normalizeMailbox } from './codes';
import { JoinCodeInput, JoinEmailStartInput, JoinEmailVerifyInput, ShareInput, type ShareLevel } from './inputs';
import { callIn, rpc } from './rpc';

export const OTP_CODE_PURPOSE = 'campus/otp-code';
const DUMMY_CHALLENGE = '00000000-0000-4000-8000-000000000000';

export interface CampusMailDeps {
  /** Delivers the six digits to the college address (file outbox in dev). The plain code never goes anywhere else. */
  sendCode: (to: string, code: string) => Promise<void>;
  generateCode?: () => string;
}
export interface JoinOpts {
  /** Keyed hash of the client IP for the per-IP limit; never the address. */
  ipHash?: string | null;
}

export interface Membership {
  campus: { id: string; name: string; cgpaRule: unknown };
  cohort: { id: string; passoutYear: number; programme: string };
  shareLevel: ShareLevel;
  verifiedVia: 'code' | 'email' | 'roster';
  verified: boolean;
  placed: boolean;
  joinedAt: string;
}

const MEMBERSHIP_SQL = `SELECT m.share_level, m.verified_via, m.verified_at, m.placed, m.joined_at,
         c.id AS campus_id, c.name AS campus_name, c.cgpa_rule, h.id AS cohort_id, h.passout_year, h.programme
    FROM cohort_members m JOIN campuses c ON c.id = m.campus_id JOIN cohorts h ON h.id = m.cohort_id
   WHERE m.user_id = $1`;

export async function membershipIn(c: UserClient, userId: string): Promise<Membership | null> {
  const r = (await c.query(MEMBERSHIP_SQL, [userId])).rows[0];
  if (!r) return null;
  return {
    campus: { id: r.campus_id, name: r.campus_name, cgpaRule: r.cgpa_rule ?? null },
    cohort: { id: r.cohort_id, passoutYear: Number(r.passout_year), programme: r.programme },
    shareLevel: r.share_level,
    verifiedVia: r.verified_via,
    verified: r.verified_at != null,
    placed: r.placed === true,
    joinedAt: (r.joined_at as Date).toISOString(),
  };
}

export async function getMyCampus(ctx: ServiceCtx): Promise<{ membership: Membership | null }> {
  try {
    return { membership: await withUserTx(ctx, (c) => membershipIn(c, ctx.userId)) };
  } catch (e) {
    throw mapPgError(e);
  }
}

/** The mailbox hash of the account's own address, only when that address was proven at sign-in. */
async function accountMailbox(ctx: ServiceCtx): Promise<string | null> {
  const row = await withUserTx(ctx, async (c) => (await c.query('SELECT email, email_verified_at FROM users WHERE id = $1', [ctx.userId])).rows[0]);
  if (!row || row.email_verified_at == null) return null;
  const mail = normalizeMailbox(String(row.email));
  return mail ? mailboxHmac(ctx.keys, mail) : null;
}

type JoinStatus = { status: string; [k: string]: unknown };
function failFromJoin(status: string): never {
  switch (status) {
    case 'rate_limited':
    case 'cooldown':
      throw new ServiceError(status === 'cooldown' ? 'try_again_shortly' : 'rate_limited', 429);
    case 'invalid_code':
      throw new ServiceError('invalid_code', 400);
    case 'invalid_cohort':
      throw new ServiceError('invalid_cohort', 400);
    case 'already_member':
      throw new ServiceError('already_member', 409);
    case 'seat_taken':
      throw new ServiceError('seat_taken', 409);
    case 'unknown_domain':
      throw new ServiceError('not_a_college_email', 422);
    default:
      throw new ServiceError('invalid_code', 400);
  }
}

/**
 * Join with the campus code. Without a cohort it only checks the code and returns the cohorts to pick from. The code is
 * hashed here; the database never sees it. A code join is unverified and does not count toward k.
 */
export async function joinByCode(ctx: ServiceCtx, input: unknown, opts: JoinOpts = {}): Promise<
  | { status: 'choose_cohort'; campus: { id: string; name: string }; cohorts: { id: string; passoutYear: number; programme: string }[] }
  | { status: 'joined'; verifiedVia: 'code' | 'email' | 'roster' }
> {
  const { code, cohortId } = parseInput(JoinCodeInput, input);
  const normalized = normalizeCampusCode(code);
  // A malformed code still costs an attempt: hash something so a bad shape is indistinguishable from a wrong code.
  const codeHash = await campusCodeHmac(ctx.keys, normalized ?? `malformed:${code}`);
  const account = cohortId ? await accountMailbox(ctx) : null;
  const res = await rpc<JoinStatus>(ctx, 'campus_join_code', [codeHash, cohortId ?? null, account, opts.ipHash ?? null]);
  if (res.status === 'joined' || res.status === 'choose_cohort') return res as never;
  return failFromJoin(res.status);
}

const sixDigits = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Step 1 of the college-email join: mail a six-digit code to an address on a domain ops registered for a campus. */
export async function startEmailJoin(ctx: ServiceCtx, input: unknown, deps: CampusMailDeps, opts: JoinOpts = {}): Promise<{ sent: true }> {
  const { email } = parseInput(JoinEmailStartInput, input);
  const mail = normalizeMailbox(email);
  if (!mail) throw new ServiceError('invalid_email', 400);
  const mailbox = await mailboxHmac(ctx.keys, mail);
  const code = (deps.generateCode ?? sixDigits)();
  const challengeId = randomUUID();
  const codeHash = await hmac(ctx.keys, OTP_CODE_PURPOSE, `${challengeId}:${code}`);
  const res = await rpc<JoinStatus>(ctx, 'campus_email_issue', [mailbox, domainOf(mail), challengeId, codeHash, opts.ipHash ?? null]);
  if (res.status !== 'sent') failFromJoin(res.status);
  try {
    await deps.sendCode(mail, code);
  } catch {
    // Name nothing: neither the address nor the code goes to a log or an error.
    throw new ServiceError('mail_unavailable', 503);
  }
  return { sent: true };
}

/**
 * Step 2: prove the mailbox with the code. The attempt is spent (and committed) before the comparison, so a wrong guess
 * counts even though it fails. Every failure is one shape (`invalid_code`).
 */
export async function verifyEmailJoin(ctx: ServiceCtx, input: unknown, opts: JoinOpts = {}): Promise<{ status: 'joined'; verifiedVia: 'email' | 'roster' }> {
  const { email, code, cohortId } = parseInput(JoinEmailVerifyInput, input);
  const mail = normalizeMailbox(email);
  if (!mail) throw new ServiceError('invalid_code', 400);
  const mailbox = await mailboxHmac(ctx.keys, mail);
  const spent = await rpc<{ status: string; challengeId?: string }>(ctx, 'campus_email_spend', [mailbox, opts.ipHash ?? null]);
  if (spent.status === 'rate_limited') throw new ServiceError('rate_limited', 429);
  // Hash even when nothing was spent so an unknown mailbox costs the same as a wrong code.
  const candidate = await hmac(ctx.keys, OTP_CODE_PURPOSE, `${spent.challengeId ?? DUMMY_CHALLENGE}:${code}`);
  if (spent.status !== 'spent' || !spent.challengeId) throw new ServiceError('invalid_code', 400);
  const res = await rpc<JoinStatus>(ctx, 'campus_email_join', [spent.challengeId, candidate, mailbox, cohortId]);
  if (res.status === 'joined') return res as never;
  return failFromJoin(res.status === 'invalid' ? 'invalid_code' : res.status);
}

/**
 * Sets the share level and records the choice as a consent row, in one transaction. Consents are append-only; the level
 * is in doc_version (`share-v1:<level>`) so the history shows which level was chosen. `granted` is true above aggregate.
 */
export async function setShareLevel(ctx: ServiceCtx, input: unknown): Promise<{ shareLevel: ShareLevel }> {
  const { level } = parseInput(ShareInput, input);
  try {
    await withUserTx(ctx, async (c) => {
      const r = await c.query('UPDATE cohort_members SET share_level = $2, updated_at = $3 WHERE user_id = $1', [ctx.userId, level, ctx.now()]);
      if (!r.rowCount) throw new ServiceError('not_in_campus', 409);
      await c.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'campus_share', $2, $3)", [ctx.userId, level !== 'aggregate', `share-v1:${level}`]);
    });
  } catch (e) {
    throw mapPgError(e);
  }
  return { shareLevel: level };
}

export async function leaveCampus(ctx: ServiceCtx): Promise<{ left: boolean }> {
  try {
    return await withUserTx(ctx, async (c) => {
      const left = await callIn<boolean>(c, 'campus_leave');
      if (left) await c.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'campus_share', false, 'share-v1:left')", [ctx.userId]);
      return { left };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

/** Every TPO read of this student (outcome lists, NAAC exports, letter views, verifications). Who read it is not shown. */
export async function listAccessLog(ctx: ServiceCtx): Promise<{ entries: { id: string; campusId: string; action: string; at: string }[] }> {
  try {
    const rows = await withUserTx(ctx, async (c) => (await c.query("SELECT id, campus_id, action, at FROM tpo_access_log WHERE action IN ('outcomes_list', 'outcome_verify', 'naac_export', 'letter_view') ORDER BY at DESC, id LIMIT 200")).rows);
    return { entries: rows.map((r) => ({ id: r.id, campusId: r.campus_id, action: r.action, at: (r.at as Date).toISOString() })) };
  } catch (e) {
    throw mapPgError(e);
  }
}
