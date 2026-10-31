import type { ServiceCtx } from '../ctx';
import { withUserTx, type UserClient } from '../db';
import { mapPgError, notFound, ServiceError } from '../errors';
import { parseInput } from '../schema';
import { mailboxHmac, normalizeMailbox } from './codes';
import { CampusScopeInput, CohortCreateInput, CohortStatsInput, InviteInput, StaffMemberInput, type CampusMetric } from './inputs';
import { callIn } from './rpc';

/**
 * The TPO side. A staff session needs a tpo_members row. Every function here runs in one transaction and calls a SECURITY
 * DEFINER function. Those answer NULL for anyone who is not staff of the campus, and NULL is a 404, so a student, a stranger
 * and a staff member of another campus all see the same thing. No function here reads a table directly.
 *
 * Decision 2026-10-31 (docs/apply.md "Open before pilot" 8): reads are side-effect free. A read runs in a READ ONLY
 * transaction (`staffReadTx`), so it cannot write a row even by mistake. Claiming an invite is its own explicit action
 * (`claimStaffInvites`, POST /api/v1/tpo/claim), and `tpoMe` only reports that an invite is waiting.
 */
export type StaffClient = UserClient;

/** The caller's verified mailbox hash, or null when the account has no verified address. */
async function verifiedMailboxIn(ctx: ServiceCtx, c: UserClient): Promise<string | null> {
  const u = (await c.query('SELECT email, email_verified_at FROM users WHERE id = $1', [ctx.userId])).rows[0];
  if (!u || u.email_verified_at == null) return null;
  const mail = normalizeMailbox(String(u.email));
  return mail ? mailboxHmac(ctx.keys, mail) : null;
}

const isWriteRoleRefusal = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42501' && String((e as { message?: unknown }).message ?? '').includes('tpo_write_role_required');

/** A staff call that may write (a mutation, or a logged disclosure). Never claims an invite. */
export async function staffTx<T>(ctx: ServiceCtx, fn: (c: StaffClient) => Promise<T>): Promise<T> {
  try {
    return await withUserTx(ctx, fn);
  } catch (e) {
    // A member of the campus without a write role (owner or officer) is told so; a stranger still gets a 404 from the NULL.
    if (isWriteRoleRefusal(e)) throw new ServiceError('forbidden', 403);
    throw mapPgError(e);
  }
}

/** A staff read. The transaction is READ ONLY: a function that tried to write would fail instead of writing. */
export async function staffReadTx<T>(ctx: ServiceCtx, fn: (c: StaffClient) => Promise<T>): Promise<T> {
  return staffTx(ctx, async (c) => {
    await c.query('SET TRANSACTION READ ONLY');
    return fn(c);
  });
}

/**
 * The one place an invite is claimed. The invitee calls this after signing in (POST /api/v1/tpo/claim). It needs a verified
 * account email that matches the invite. Idempotent: a second call claims nothing.
 */
export async function claimStaffInvites(ctx: ServiceCtx): Promise<{ claimed: number }> {
  return staffTx(ctx, async (c) => {
    const h = await verifiedMailboxIn(ctx, c);
    return { claimed: h ? await callIn<number>(c, 'tpo_claim_invites', [h]) : 0 };
  });
}

export interface StaffMembership {
  campusId: string;
  campusName: string;
  role: 'owner' | 'staff';
}

/** The campus a call is about: the one named, or the only one the caller staffs. */
export async function resolveCampus(c: UserClient, campusId?: string): Promise<string> {
  const list = await callIn<StaffMembership[]>(c, 'tpo_memberships');
  if (campusId) {
    if (!list.some((m) => m.campusId === campusId)) throw notFound();
    return campusId;
  }
  if (list.length === 0) throw notFound();
  if (list.length > 1) throw new ServiceError('campus_required', 400);
  return list[0]!.campusId;
}

export const orNotFound = <T>(v: T | null): T => {
  if (v === null || v === undefined) throw notFound();
  return v;
};

/**
 * Who am I as staff. Empty for everyone else; not an error, so the console can tell a student from a TPO. Writes nothing:
 * `pendingInvite` says an invite for my verified mailbox is waiting, and the console then calls `claimStaffInvites`.
 */
export async function tpoMe(ctx: ServiceCtx): Promise<{ campuses: StaffMembership[]; pendingInvite: boolean }> {
  return staffReadTx(ctx, async (c) => {
    const h = await verifiedMailboxIn(ctx, c);
    return {
      campuses: await callIn<StaffMembership[]>(c, 'tpo_memberships'),
      pendingInvite: h ? (await callIn<boolean>(c, 'tpo_has_pending_invite', [h])) === true : false,
    };
  });
}

export async function listCohorts(ctx: ServiceCtx, input: unknown = {}) {
  const { campusId } = parseInput(CampusScopeInput, input);
  return staffReadTx(ctx, async (c) => {
    const id = await resolveCampus(c, campusId);
    return { cohorts: orNotFound(await callIn<unknown[] | null>(c, 'tpo_list_cohorts', [id])) as Cohort[] };
  });
}
export interface Cohort {
  id: string;
  passoutYear: number;
  programme: string;
  rosterSize: number;
  snapshotDay: string | null;
  joined: number | null;
  joinedSuppressed: boolean;
}

export async function createCohort(ctx: ServiceCtx, input: unknown): Promise<{ id: string; created: boolean }> {
  const i = parseInput(CohortCreateInput, input);
  return staffTx(ctx, async (c) => {
    const id = await resolveCampus(c, i.campusId);
    return orNotFound(await callIn<{ id: string; created: boolean } | null>(c, 'tpo_create_cohort', [id, i.passoutYear, i.programme]));
  });
}

/**
 * One cohort's fixed metrics from the latest nightly snapshot: counts over verified members only, k = 10 (a cell is
 * hidden under 10 or when 10 or fewer are outside it), complementary suppression inside exclusive groups, rounded to 5.
 * `metric` narrows the answer to one fixed metric; it is a name from the list, never a filter on people.
 */
export async function cohortStats(ctx: ServiceCtx, input: unknown): Promise<{ day: string | null; metrics: { metric: CampusMetric; value: number | null; suppressed: boolean }[] }> {
  const { cohortId, metric } = parseInput(CohortStatsInput, input);
  const r = await staffReadTx(ctx, async (c) => orNotFound(await callIn<{ day: string | null; metrics: { metric: CampusMetric; value: number | null; suppressed: boolean }[] } | null>(c, 'tpo_cohort_stats', [cohortId])));
  return metric ? { day: r.day, metrics: r.metrics.filter((m) => m.metric === metric) } : r;
}

export async function inviteStaff(ctx: ServiceCtx, input: unknown): Promise<{ status: 'invited' | 'exists' }> {
  const i = parseInput(InviteInput, input);
  const mail = normalizeMailbox(i.email);
  if (!mail) throw new ServiceError('invalid_email', 400);
  const h = await mailboxHmac(ctx.keys, mail);
  return staffTx(ctx, async (c) => {
    const campus = await resolveCampus(c, i.campusId);
    return orNotFound(await callIn<{ status: 'invited' | 'exists' } | null>(c, 'tpo_invite_staff', [campus, h]));
  });
}

export async function listStaff(ctx: ServiceCtx, input: unknown = {}) {
  const { campusId } = parseInput(CampusScopeInput, input);
  return staffReadTx(ctx, async (c) => {
    const id = await resolveCampus(c, campusId);
    return { staff: orNotFound(await callIn<{ id: string; role: 'owner' | 'staff'; claimed: boolean; createdAt: string; expiresAt: string | null; expired: boolean }[] | null>(c, 'tpo_list_staff', [id])) };
  });
}

/** Owner only. Removes a staff seat or an open invite. The last owner cannot be removed (409). Logged. */
export async function removeStaff(ctx: ServiceCtx, input: unknown): Promise<{ status: 'removed' }> {
  const i = parseInput(StaffMemberInput, input);
  return staffTx(ctx, async (c) => {
    const campus = await resolveCampus(c, i.campusId);
    const r = orNotFound(await callIn<{ status: 'removed' | 'last_owner' } | null>(c, 'tpo_remove_staff', [campus, i.memberId]));
    if (r.status === 'last_owner') throw new ServiceError('last_owner', 409);
    return { status: 'removed' as const };
  });
}

/** Owner only. Hands ownership to a claimed staff member; the caller becomes staff. Logged. */
export async function transferOwnership(ctx: ServiceCtx, input: unknown): Promise<{ status: 'transferred' }> {
  const i = parseInput(StaffMemberInput, input);
  return staffTx(ctx, async (c) => {
    const campus = await resolveCampus(c, i.campusId);
    return orNotFound(await callIn<{ status: 'transferred' } | null>(c, 'tpo_transfer_ownership', [campus, i.memberId]));
  });
}
