import { detectScamSignals, evaluateEligibility, parseCriteria, type CgpaRule, type Criterion, type EligibilityProfileInput } from '@hirelane/engine';
import type { ServiceCtx } from '../ctx';
import { withUserTx } from '../db';
import { mapPgError } from '../errors';
import { parseInput } from '../schema';
import { istDay } from './ist';
import { PublishDriveInput } from './inputs';
import { membershipIn } from './membership';
import { callIn } from './rpc';
import { orNotFound, resolveCampus, staffReadTx, staffTx } from './tpo';

const num = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));

/** eligibility_profiles row (snake_case, numerics as strings from pg) to the engine's input. Confirmed by construction. */
export function profileFromRow(r: Record<string, unknown> | undefined): EligibilityProfileInput | null {
  if (!r) return null;
  const out: Record<string, unknown> = { confirmed: true };
  const put = (k: string, v: unknown) => {
    if (v !== null && v !== undefined) out[k] = v;
  };
  for (const k of ['pct_10', 'pct_secondary', 'grad_score', 'grad_pct_equiv']) put(k, num(r[k]));
  for (const k of ['grad_scale', 'active_backlogs', 'backlog_history', 'gap_years', 'passout_year']) put(k, num(r[k]));
  for (const k of ['board_10', 'secondary_kind', 'board_secondary', 'degree', 'branch_code', 'branch_raw', 'grad_conversion']) put(k, r[k]);
  for (const k of ['grad_is_final', 'lateral_entry']) put(k, r[k]);
  return out as unknown as EligibilityProfileInput;
}

export const asCgpaRule = (v: unknown): CgpaRule =>
  v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'linear' && typeof (v as { a?: unknown }).a === 'number' && typeof (v as { b?: unknown }).b === 'number'
    ? (v as CgpaRule)
    : null;

export interface StudentDrive {
  id: string;
  title: string;
  link: string | null;
  noticeText: string;
  /** Closing date (YYYY-MM-DD, India) the TPO set, or null when the notice named none. */
  deadline: string | null;
  /** Free text from the TPO: the rounds, and the documents to bring. */
  rounds: string | null;
  documents: string | null;
  publishedAt: string;
  verdict: 'eligible' | 'unknown';
  reasons: string[];
  /** Always set by listMyDrives; optional so older callers and fixtures still type-check. */
  rules?: { text: string; status: 'pass' | 'unknown' }[];
}

/**
 * The student's drive inbox: published drives for their cohort, minus the ones their own confirmed profile fails. Eligible
 * and unknown both arrive (unknown never blocks). A placed student gets none. The verdict is computed here, on the
 * student's own request, from their own profile; a TPO never sees it per student.
 */
export async function listMyDrives(ctx: ServiceCtx): Promise<{ placed: boolean; drives: StudentDrive[] }> {
  try {
    return await withUserTx(ctx, async (c) => {
      const m = await membershipIn(c, ctx.userId);
      if (!m) return { placed: false, drives: [] };
      if (m.placed) return { placed: true, drives: [] };
      // Scam flags are for staff: the columns are not granted to a student session, and are not selected here.
      const rows = (
        await c.query(
          `SELECT id, title, link, notice_text, criteria, published_at, deadline::text AS deadline, rounds, documents FROM drives
            WHERE deadline IS NULL OR deadline >= $1::date ORDER BY published_at DESC, id LIMIT 100`,
          [istDay(ctx.now())],
        )
      ).rows;
      const profile = profileFromRow((await c.query('SELECT * FROM eligibility_profiles WHERE user_id = $1', [ctx.userId])).rows[0]);
      const cgpaRule = asCgpaRule(m.campus.cgpaRule);
      const drives: StudentDrive[] = [];
      for (const r of rows) {
        const criteria = (Array.isArray(r.criteria) ? r.criteria : []) as Criterion[];
        const res = evaluateEligibility(criteria, profile, { cgpaRule });
        if (res.overall === 'fail') continue;
        drives.push({
          id: r.id,
          title: r.title,
          link: r.link ?? null,
          noticeText: r.notice_text,
          deadline: r.deadline ?? null,
          rounds: r.rounds ?? null,
          documents: r.documents ?? null,
          publishedAt: (r.published_at as Date).toISOString(),
          verdict: res.overall === 'pass' ? 'eligible' : 'unknown',
          reasons: res.verdicts.map((v) => v.reason),
          rules: res.verdicts.map((v) => ({ text: v.reason, status: v.status === 'pass' ? ('pass' as const) : ('unknown' as const) })),
        });
      }
      return { placed: false, drives };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}

/**
 * The drive inbox (C4). Parses the pasted notice with the engine (criteria and scam signals; rules only, 0 LLM calls) and
 * publishes it to one cohort. The link is stored as text and is never fetched. A flagged drive is still published: the
 * flags travel with it and show to students and staff.
 */
export async function publishDrive(ctx: ServiceCtx, input: unknown) {
  const i = parseInput(PublishDriveInput, input);
  const criteria = parseCriteria(i.noticeText);
  const scam = detectScamSignals(i.noticeText, { url: i.link ?? null });
  const flags = scam.signals.map((s) => ({ id: s.id, severity: s.severity, quote: s.quote.slice(0, 200), source: s.source }));
  const id = await staffTx(ctx, async (c) =>
    orNotFound(
      await callIn<string | null>(c, 'tpo_create_drive', [
        i.cohortId,
        i.title,
        i.link ?? null,
        i.noticeText,
        JSON.stringify(criteria),
        JSON.stringify(flags),
        scam.risk,
        i.deadline ?? null,
        i.rounds || null,
        i.documents || null,
        true,
      ]),
    ),
  );
  return { id, criteria, scamRisk: scam.risk, scamFlags: flags };
}

export async function listDrives(ctx: ServiceCtx, input: unknown = {}) {
  const campusId = (input as { campusId?: string } | null)?.campusId;
  return staffReadTx(ctx, async (c) => {
    const id = await resolveCampus(c, campusId);
    return { drives: orNotFound(await callIn<unknown[] | null>(c, 'tpo_list_drives', [id])) };
  });
}

/** Eligible / unknown / ineligible counts for a drive from the nightly snapshot, with the same suppression as cohort stats. */
export async function driveCounts(ctx: ServiceCtx, input: unknown) {
  const { id } = parseInput(IdOnly, input);
  return staffReadTx(ctx, async (c) => orNotFound(await callIn<{ day: string | null; metrics: { metric: string; value: number | null; suppressed: boolean }[] } | null>(c, 'tpo_drive_counts', [id])));
}
import { CampusIdInput as IdOnly } from './inputs';
