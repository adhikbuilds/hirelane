/**
 * `campus:stats` (Amendment B section 15): the nightly snapshot behind every TPO number. 0 LLM calls.
 *
 * Writes cohort_stats_daily, one row per cohort, day and fixed metric: n members with the attribute out of p in the
 * population, counted over VERIFIED members only (college email or roster match; a code join never counts, so a
 * code-sharing crowd cannot inflate k). The rows are raw counts and the table is revoked from the app role: k = 10,
 * complementary suppression and rounding to 5 happen in the SECURITY DEFINER functions of migration 0011a.
 *
 * interview_reported and offer_reported count only members at share level 'aggregate' (p is that population): members who share
 * at 'outcomes' or 'full' are listed to the TPO by name, and an aggregate that included them could be subtracted from the named list.
 *
 * Roster rows are only STAGED by the TPO's import; campus_apply_roster() applies them here, before counting, so verification and
 * `placed` change once a day and a member whose placed flag changed in the last day is left out of drive populations.
 *
 * Then, for each published drive, it evaluates every non-placed member of the drive's cohort against the drive's parsed
 * criteria (engine evaluateEligibility, the campus CGPA rule applied), stores the member's own verdict in drive_checks
 * (readable only by that member) and writes the verified counts as drive_eligible / drive_unknown / drive_ineligible
 * snapshot metrics. Members with no confirmed profile are "unknown", and unknown is never a block.
 * A drive's counts are released only if its result differs from every earlier released drive of the cohort for either none or at
 * least K_DRIVE (10) verified members, so near-identical drives cannot be differenced to isolate one student.
 *
 * Idempotent: re-running on the same day replaces that day's rows. Rows older than 35 days are pruned. Logs carry counts only.
 */
import { evaluateEligibility, findUniversityRule, type CgpaRule, type Criterion, type EligibilityProfileInput } from '@hirelane/engine';
import type { Task, TaskList } from 'graphile-worker';
import { adminRun, type Run } from './resume-common';

export const KEEP_DAYS = 35;
/** Two released drives of a cohort must differ for zero or at least this many verified members. */
export const K_DRIVE = 10;

type Q = Parameters<Parameters<Run>[0]>[0];

/** Every metric the snapshot writes for a cohort. Must equal the list in 0011a tpo_cohort_stats (a test checks it). */
export const COHORT_METRICS = [
  'joined_verified',
  'stage_no_resume',
  'stage_resume_unconfirmed',
  'stage_confirmed',
  'ats_readable',
  'blocker_active_backlog',
  'blocker_grad_below_60',
  'blocker_secondary_below_60',
  'blocker_gap_year',
  'interview_reported',
  'offer_reported',
  'placed_on_roster',
] as const;

const COHORT_SQL = `
WITH v AS (
  SELECT m.cohort_id, m.user_id, m.placed, m.share_level FROM cohort_members m WHERE m.verified_at IS NOT NULL
), f AS (
  SELECT v.cohort_id, v.placed, (v.share_level = 'aggregate') AS agg,
         EXISTS (SELECT 1 FROM resumes r WHERE r.user_id = v.user_id AND r.parent_id IS NULL AND r.deleted_at IS NULL AND r.purged_at IS NULL
                    AND r.parse_status IN ('parsed', 'confirmed', 'needs_text')) AS has_resume,
         EXISTS (SELECT 1 FROM resumes r WHERE r.user_id = v.user_id AND r.parent_id IS NULL AND r.deleted_at IS NULL AND r.purged_at IS NULL
                    AND r.parse_status IN ('parsed', 'confirmed') AND r.text_layer = 'readable') AS readable,
         ep.user_id IS NOT NULL AS confirmed,
         coalesce(ep.active_backlogs, 0) > 0 AS backlog,
         ep.grad_pct_equiv < 60 AS grad_low,
         ep.pct_secondary < 60 AS secondary_low,
         coalesce(ep.gap_years, 0) > 0 AS gap,
         EXISTS (SELECT 1 FROM outcomes o WHERE o.user_id = v.user_id AND o.cohort_id = v.cohort_id AND o.kind = 'interview') AS interview,
         EXISTS (SELECT 1 FROM outcomes o WHERE o.user_id = v.user_id AND o.cohort_id = v.cohort_id AND o.kind = 'offer') AS offer
    FROM v LEFT JOIN eligibility_profiles ep ON ep.user_id = v.user_id
), a AS (
  SELECT cohort_id,
         count(*)::int AS total,
         count(*) FILTER (WHERE NOT confirmed AND NOT has_resume)::int AS no_resume,
         count(*) FILTER (WHERE NOT confirmed AND has_resume)::int AS unconfirmed,
         count(*) FILTER (WHERE confirmed)::int AS confirmed,
         count(*) FILTER (WHERE has_resume)::int AS with_resume,
         count(*) FILTER (WHERE has_resume AND readable)::int AS readable,
         count(*) FILTER (WHERE confirmed AND backlog)::int AS backlog,
         count(*) FILTER (WHERE confirmed AND grad_low)::int AS grad_low,
         count(*) FILTER (WHERE confirmed AND secondary_low)::int AS secondary_low,
         count(*) FILTER (WHERE confirmed AND gap)::int AS gap,
         count(*) FILTER (WHERE agg AND interview)::int AS interview,
         count(*) FILTER (WHERE agg AND offer)::int AS offer,
         count(*) FILTER (WHERE agg)::int AS agg_total,
         count(*) FILTER (WHERE placed)::int AS placed
    FROM f GROUP BY cohort_id
)
INSERT INTO cohort_stats_daily (cohort_id, day, metric, n, p)
SELECT a.cohort_id, $1::date, x.metric, x.n, x.p
  FROM a CROSS JOIN LATERAL (VALUES
    ('joined_verified', a.total, a.total),
    ('stage_no_resume', a.no_resume, a.total),
    ('stage_resume_unconfirmed', a.unconfirmed, a.total),
    ('stage_confirmed', a.confirmed, a.total),
    ('ats_readable', a.readable, a.with_resume),
    ('blocker_active_backlog', a.backlog, a.confirmed),
    ('blocker_grad_below_60', a.grad_low, a.confirmed),
    ('blocker_secondary_below_60', a.secondary_low, a.confirmed),
    ('blocker_gap_year', a.gap, a.confirmed),
    ('interview_reported', a.interview, a.agg_total),
    ('offer_reported', a.offer, a.agg_total),
    ('placed_on_roster', a.placed, a.total)
  ) AS x(metric, n, p)
ON CONFLICT (cohort_id, day, metric) DO UPDATE SET n = EXCLUDED.n, p = EXCLUDED.p`;

const num = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));

/** eligibility_profiles row to the engine's input (pg returns numerics as strings). Null when there is no confirmed row. */
export function profileInput(r: Record<string, unknown> | null | undefined): EligibilityProfileInput | null {
  if (!r || r['confirmed_at'] == null) return null;
  const out: Record<string, unknown> = { confirmed: true };
  const put = (k: string, v: unknown) => {
    if (v !== null && v !== undefined) out[k] = v;
  };
  for (const k of ['pct_10', 'pct_secondary', 'grad_score', 'grad_pct_equiv', 'grad_scale', 'active_backlogs', 'backlog_history', 'gap_years', 'passout_year', 'admission_year']) put(k, num(r[k]));
  for (const k of ['board_10', 'secondary_kind', 'board_secondary', 'degree', 'branch_code', 'branch_raw', 'grad_conversion', 'grad_is_final', 'lateral_entry', 'university_scheme']) put(k, r[k]);
  return out as unknown as EligibilityProfileInput;
}

const cgpaRule = (v: unknown): CgpaRule =>
  v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'linear' && typeof (v as { a?: unknown }).a === 'number' && typeof (v as { b?: unknown }).b === 'number' ? (v as CgpaRule) : null;

export type Verdict = 'eligible' | 'unknown' | 'ineligible';
export const verdictOf = (overall: 'pass' | 'fail' | 'unknown'): Verdict => (overall === 'pass' ? 'eligible' : overall === 'fail' ? 'ineligible' : 'unknown');

async function evaluateDrives(c: Q, day: string): Promise<{ drives: number; checks: number }> {
  const drives = (
    await c.query(
      `SELECT d.id, d.cohort_id, d.criteria, ca.cgpa_rule, ca.name AS campus_name FROM drives d JOIN campuses ca ON ca.id = d.campus_id WHERE d.status = 'published' ORDER BY d.cohort_id, d.published_at, d.id`,
    )
  ).rows as { id: string; cohort_id: string; criteria: unknown; cgpa_rule: unknown; campus_name: string }[];
  let checks = 0;
  const released = new Map<string, Map<string, Verdict>[]>();
  // Drives that were published, had counts released, and were closed since: a TPO still holds those numbers, so a new drive is
  // compared with them too (over the members both cover; a member only one of them has can only make the comparison stricter).
  const closed = (
    await c.query(
      `SELECT d.id, d.cohort_id, dc.user_id, dc.verdict FROM drives d JOIN drive_checks dc ON dc.drive_id = d.id
        WHERE d.status = 'closed' AND EXISTS (SELECT 1 FROM cohort_stats_daily s WHERE s.cohort_id = d.cohort_id AND s.metric = 'drive_eligible:' || d.id::text)`,
    )
  ).rows as { id: string; cohort_id: string; user_id: string; verdict: Verdict }[];
  const closedByCohort = new Map<string, Map<string, Map<string, Verdict>>>();
  for (const r of closed) {
    const perCohort = closedByCohort.get(r.cohort_id) ?? new Map<string, Map<string, Verdict>>();
    const vec = perCohort.get(r.id) ?? new Map<string, Verdict>();
    vec.set(r.user_id, r.verdict);
    perCohort.set(r.id, vec);
    closedByCohort.set(r.cohort_id, perCohort);
  }
  for (const d of drives) {
    const criteria = (Array.isArray(d.criteria) ? d.criteria : []) as Criterion[];
    const rule = cgpaRule(d.cgpa_rule);
    // The campus's university row: a scheme-keyed (VTU) or disputed (Mumbai) one is never overridden by the campus rule.
    const universityRule = findUniversityRule(d.campus_name);
    const members = (
      await c.query(
        `SELECT m.user_id AS member_id, m.verified_at IS NOT NULL AS verified,
                (m.placed_changed_at IS NOT NULL AND m.placed_changed_at > now() - interval '24 hours') AS recent, ep.* FROM cohort_members m
           LEFT JOIN eligibility_profiles ep ON ep.user_id = m.user_id
          WHERE m.cohort_id = $1 AND NOT m.placed`,
        [d.cohort_id],
      )
    ).rows as Record<string, unknown>[];
    const count: Record<Verdict, number> = { eligible: 0, unknown: 0, ineligible: 0 };
    let population = 0;
    const vector = new Map<string, Verdict>();
    for (const m of members) {
      const verdict = verdictOf(evaluateEligibility(criteria, profileInput(m), { cgpaRule: rule, universityRule }).overall);
      await c.query(
        `INSERT INTO drive_checks (drive_id, user_id, verdict, checked_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (drive_id, user_id) DO UPDATE SET verdict = EXCLUDED.verdict, checked_at = EXCLUDED.checked_at`,
        [d.id, m['member_id'], verdict],
      );
      checks++;
      // Counted: verified members whose placed flag has not just changed (they would move a published number by one).
      if (m['verified'] === true && m['recent'] !== true) {
        population++;
        count[verdict]++;
        vector.set(String(m['member_id']), verdict);
      }
    }
    const metrics = (['eligible', 'unknown', 'ineligible'] as const).map((v) => `drive_${v}:${d.id}`);
    await c.query('DELETE FROM cohort_stats_daily WHERE cohort_id = $1 AND day = $2::date AND metric = ANY($3::text[])', [d.cohort_id, day, metrics]);
    const earlier = released.get(d.cohort_id) ?? [];
    const tooClose = earlier.some((other) => {
      let diff = 0;
      for (const [u, v] of vector) if (other.get(u) !== v) diff++;
      for (const u of other.keys()) if (!vector.has(u)) diff++;
      return diff > 0 && diff < K_DRIVE;
    });
    const tooCloseToClosed = [...(closedByCohort.get(d.cohort_id)?.values() ?? [])].some((other) => {
      let diff = 0;
      for (const [u, v] of vector) if (other.has(u) && other.get(u) !== v) diff++;
      return diff > 0 && diff < K_DRIVE;
    });
    if (tooClose || tooCloseToClosed) continue;
    released.set(d.cohort_id, [...earlier, vector]);
    for (const verdict of ['eligible', 'unknown', 'ineligible'] as const) {
      await c.query(
        `INSERT INTO cohort_stats_daily (cohort_id, day, metric, n, p) VALUES ($1, $2::date, $3, $4, $5)
         ON CONFLICT (cohort_id, day, metric) DO UPDATE SET n = EXCLUDED.n, p = EXCLUDED.p`,
        [d.cohort_id, day, `drive_${verdict}:${d.id}`, count[verdict], population],
      );
    }
  }
  // Checks for people who left the cohort, or became placed, no longer mean anything.
  await c.query(
    `DELETE FROM drive_checks dc USING drives d
      WHERE dc.drive_id = d.id AND NOT EXISTS (SELECT 1 FROM cohort_members m WHERE m.user_id = dc.user_id AND m.cohort_id = d.cohort_id AND NOT m.placed)`,
  );
  return { drives: drives.length, checks };
}

export interface CampusStatsResult {
  cohorts: number;
  drives: number;
  checks: number;
  pruned: number;
}

/** One connection, one transaction: a failed run leaves yesterday's snapshot untouched. */
export async function runCampusStats(run: Run, now: Date): Promise<CampusStatsResult> {
  const day = now.toISOString().slice(0, 10);
  return run(async (c) => {
    await c.query('BEGIN');
    try {
      await c.query('SELECT campus_apply_roster()');
      await c.query(COHORT_SQL, [day]);
      const cohorts = (await c.query('SELECT count(DISTINCT cohort_id)::int AS n FROM cohort_stats_daily WHERE day = $1::date AND metric = $2', [day, 'joined_verified'])).rows[0]!['n'] as number;
      const { drives, checks } = await evaluateDrives(c, day);
      const pruned = (await c.query('DELETE FROM cohort_stats_daily WHERE day < $1::date - $2::int', [day, KEEP_DAYS])).rowCount ?? 0;
      await c.query('COMMIT');
      return { cohorts, drives, checks, pruned };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  });
}

export function createCampusStatsTasks(over: { run?: Run; now?: () => Date } = {}): TaskList {
  const stats: Task = async (_payload, helpers) => {
    const r = await runCampusStats(over.run ?? adminRun, (over.now ?? (() => new Date()))());
    helpers.logger.info(`campus:stats cohorts ${r.cohorts} drives ${r.drives} checks ${r.checks} pruned ${r.pruned}`);
  };
  return { 'campus:stats': stats };
}
