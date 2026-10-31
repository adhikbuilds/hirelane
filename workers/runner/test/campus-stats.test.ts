/**
 * campus:stats against real Postgres (a throwaway database; never the shared hirelane_test schema). Synthetic data only.
 * Covers: counts over verified members only, exclusive stages, the fixed metric list matching the SQL whitelist, drive
 * evaluation (eligible and unknown both counted, placed excluded), idempotent re-runs, pruning, atomic failure, and a read
 * back through the TPO definer functions. 0 LLM calls.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCrontab } from 'graphile-worker';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '@hirelane/db';
import { parseCriteria } from '@hirelane/engine';
import { TEST_URL } from '../../../packages/db/test/helpers';
import { mkUser } from '../../../packages/db/test/auth-helpers';
import { COHORT_METRICS, createCampusStatsTasks, KEEP_DAYS, profileInput, runCampusStats, verdictOf } from '../src/tasks/campus-stats';
import { taskList } from '../src/tasks/index';
import type { Run } from '../src/tasks/resume-common';

const DBNAME = `hl_runner_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const url = new URL(TEST_URL);
let c: Client;
let admin: Client;
let run: Run;
const DAY = new Date('2026-10-29T02:20:00Z');

beforeAll(async () => {
  admin = new Client({ connectionString: TEST_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${DBNAME}`);
  url.pathname = `/${DBNAME}`;
  c = new Client({ connectionString: url.toString() });
  await c.connect();
  await applyMigrations(c, resolve(import.meta.dirname, '../../../packages/db/migrations'));
  run = (fn) => fn(c as never);
}, 60_000);
afterAll(async () => {
  await c?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${DBNAME}`).catch(() => undefined);
  await admin?.end();
});

interface World {
  campusId: string;
  cohortId: string;
}
async function mkWorld(cgpaRule: unknown = null): Promise<World> {
  const campusId = randomUUID();
  const cohortId = randomUUID();
  await c.query('INSERT INTO campuses (id, name, code_hmac, cgpa_rule) VALUES ($1, $2, $3, $4)', [campusId, `Campus ${campusId.slice(0, 6)}`, `h-${campusId}`, cgpaRule]);
  await c.query("INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2026, 'B.Tech')", [cohortId, campusId]);
  return { campusId, cohortId };
}
interface Spec {
  via?: 'code' | 'email' | 'roster';
  placed?: boolean;
  resume?: 'readable' | 'none' | null;
  profile?: Record<string, unknown> | null;
  outcome?: 'interview' | 'offer' | null;
}
async function mkMember(w: World, s: Spec = {}): Promise<string> {
  const u = await mkUser(c);
  const via = s.via ?? 'email';
  await c.query(
    `INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, placed) VALUES ($1, $2, $3, $4, ${via === 'code' ? 'NULL' : 'now()'}, $5)`,
    [u.id, w.campusId, w.cohortId, via, s.placed ?? false],
  );
  if (s.resume) {
    await c.query(
      "INSERT INTO resumes (user_id, source, mime, size_bytes, file_hmac, blob_key, parse_status, text_layer) VALUES ($1, 'upload', 'application/pdf', 10, $2, $3, $4, $5)",
      [u.id, `f-${randomUUID()}`, `resumes/${u.id}/${randomUUID()}`, s.resume === 'readable' ? 'parsed' : 'needs_text', s.resume === 'readable' ? 'readable' : 'none'],
    );
  }
  if (s.profile) {
    const cols = Object.keys(s.profile);
    await c.query(`INSERT INTO eligibility_profiles (user_id, confirmed_at, ${cols.join(', ')}) VALUES ($1, now(), ${cols.map((_, i) => `$${i + 2}`).join(', ')})`, [u.id, ...Object.values(s.profile)]);
  }
  if (s.outcome) {
    await c.query("INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer) VALUES ($1, $2, $3, $4, 'Acme')", [u.id, w.campusId, w.cohortId, s.outcome]);
  }
  return u.id;
}
const many = async (w: World, n: number, s: Spec | ((i: number) => Spec)): Promise<string[]> => {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(await mkMember(w, typeof s === 'function' ? s(i) : s));
  return out;
};
const snap = async (w: World, day = '2026-10-29') =>
  Object.fromEntries((await c.query('SELECT metric, n, p FROM cohort_stats_daily WHERE cohort_id = $1 AND day = $2::date', [w.cohortId, day])).rows.map((r) => [r.metric, [r.n, r.p]]));

describe('campus:stats cohort snapshot', () => {
  it('counts verified members only: a code join, however many, never moves a number', async () => {
    const w = await mkWorld();
    await many(w, 12, { resume: 'readable' });
    await many(w, 50, { via: 'code', resume: 'readable', outcome: 'offer', profile: { active_backlogs: 2 } });
    await runCampusStats(run, DAY);
    const s = await snap(w);
    expect(s['joined_verified']).toEqual([12, 12]);
    expect(s['offer_reported']).toEqual([0, 12]);
    expect(s['stage_confirmed']).toEqual([0, 12]);
  });

  it('writes exactly the fixed metrics, and the stages are exclusive and add up to the verified total', async () => {
    const w = await mkWorld();
    await many(w, 3, { resume: null });
    await many(w, 4, { resume: 'readable' });
    await many(w, 2, { resume: 'none' });
    await many(w, 5, { resume: 'readable', profile: { pct_10: 80 } });
    await many(w, 1, { resume: null, profile: { pct_10: 80 } });
    await runCampusStats(run, DAY);
    const s = await snap(w);
    expect(Object.keys(s).sort()).toEqual([...COHORT_METRICS].sort());
    expect(s['joined_verified']).toEqual([15, 15]);
    expect(s['stage_no_resume']![0]! + s['stage_resume_unconfirmed']![0]! + s['stage_confirmed']![0]!).toBe(15);
    expect(s['stage_no_resume']).toEqual([3, 15]);
    expect(s['stage_resume_unconfirmed']).toEqual([6, 15]);
    expect(s['stage_confirmed']).toEqual([6, 15]);
    // ATS readability is out of members with a resume: 4 + 5 readable, 2 image-only.
    expect(s['ats_readable']).toEqual([9, 11]);
  });

  it('counts blockers among members with a confirmed profile, and outcomes and placed among all verified', async () => {
    const w = await mkWorld();
    await many(w, 4, { profile: { active_backlogs: 1, grad_pct_equiv: 55, pct_secondary: 58, gap_years: 1 } });
    await many(w, 6, { profile: { active_backlogs: 0, grad_pct_equiv: 72, pct_secondary: 80, gap_years: 0 } });
    await many(w, 3, { outcome: 'interview', placed: true });
    await mkMember(w, { outcome: 'offer' });
    await runCampusStats(run, DAY);
    const s = await snap(w);
    expect(s['blocker_active_backlog']).toEqual([4, 10]);
    expect(s['blocker_grad_below_60']).toEqual([4, 10]);
    expect(s['blocker_secondary_below_60']).toEqual([4, 10]);
    expect(s['blocker_gap_year']).toEqual([4, 10]);
    expect(s['interview_reported']).toEqual([3, 14]);
    expect(s['offer_reported']).toEqual([1, 14]);
    expect(s['placed_on_roster']).toEqual([3, 14]);
  });

  it('interview and offer counts cover aggregate-level members only, so named outcomes cannot be subtracted to find who opted out', async () => {
    const w = await mkWorld();
    // 12 members share only in aggregate; 2 of them report an offer. 3 members share names at "outcomes" and 3 more at "full".
    await many(w, 10, {});
    await many(w, 2, { outcome: 'offer' });
    const named = await many(w, 3, { outcome: 'offer' });
    const full = await many(w, 3, { outcome: 'interview' });
    await c.query("UPDATE cohort_members SET share_level = 'outcomes' WHERE user_id = ANY($1)", [named]);
    await c.query("UPDATE cohort_members SET share_level = 'full' WHERE user_id = ANY($1)", [full]);
    await runCampusStats(run, DAY);
    const s = await snap(w);
    expect(s['offer_reported']).toEqual([2, 12]); // not [5, 18]: the 3 named offers are not in the aggregate
    expect(s['interview_reported']).toEqual([0, 12]); // not [3, 18]
    expect(s['joined_verified']).toEqual([18, 18]); // the headcount itself is unchanged
  });

  it('applies the staged roster before it counts: a proven mailbox on the roster becomes verified and takes placed, once', async () => {
    const w = await mkWorld();
    await many(w, 12, {});
    const u = await mkMember(w, { via: 'code' });
    await c.query("UPDATE cohort_members SET email_hmac = 'box-r' WHERE user_id = $1", [u]);
    await c.query("INSERT INTO cohort_roster (campus_id, cohort_id, email_hmac, placed) VALUES ($1, $2, 'box-r', true)", [w.campusId, w.cohortId]);
    expect((await snap(w)).joined_verified).toBeUndefined();
    await runCampusStats(run, DAY);
    expect((await snap(w))['joined_verified']).toEqual([13, 13]);
    expect((await snap(w))['placed_on_roster']).toEqual([1, 13]);
    const m = (await c.query('SELECT verified_via, placed, placed_changed_at IS NOT NULL AS ch FROM cohort_members WHERE user_id = $1', [u])).rows[0];
    expect(m).toEqual({ verified_via: 'roster', placed: true, ch: true });
  });

  it("does not count an outcome reported at a campus the student has since left toward the new cohort's numbers", async () => {
    const a = await mkWorld();
    const b = await mkWorld();
    const movers = await many(b, 12, {});
    for (const u of movers) {
      await c.query("INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer) VALUES ($1, $2, $3, 'offer', 'Old Campus Co'), ($1, $2, $3, 'interview', 'Old Campus Co')", [u, a.campusId, a.cohortId]);
    }
    await mkMember(b, { outcome: 'offer' });
    await runCampusStats(run, DAY);
    const s = await snap(b);
    expect(s['joined_verified']).toEqual([13, 13]);
    expect(s['offer_reported']).toEqual([1, 13]);
    expect(s['interview_reported']).toEqual([0, 13]);
  });

  it('is idempotent for a day, keeps one row per day, and prunes old snapshots', async () => {
    const w = await mkWorld();
    await many(w, 3, {});
    await runCampusStats(run, DAY);
    await many(w, 2, {});
    const again = await runCampusStats(run, DAY);
    expect((await snap(w))['joined_verified']).toEqual([5, 5]);
    expect((await c.query('SELECT count(*)::int AS n FROM cohort_stats_daily WHERE cohort_id = $1 AND metric = $2', [w.cohortId, 'joined_verified'])).rows[0].n).toBe(1);
    expect(again.cohorts).toBeGreaterThan(0);

    await c.query("INSERT INTO cohort_stats_daily (cohort_id, day, metric, n, p) VALUES ($1, '2026-09-01', 'joined_verified', 1, 1)", [w.cohortId]);
    await c.query("INSERT INTO cohort_stats_daily (cohort_id, day, metric, n, p) VALUES ($1, '2026-10-20', 'joined_verified', 1, 1)", [w.cohortId]);
    const r = await runCampusStats(run, DAY);
    expect(r.pruned).toBeGreaterThanOrEqual(1);
    const days = (await c.query("SELECT day::text AS d FROM cohort_stats_daily WHERE cohort_id = $1 AND metric = 'joined_verified' ORDER BY day", [w.cohortId])).rows.map((x) => x.d);
    expect(days).toEqual(['2026-10-20', '2026-10-29']);
    expect(KEEP_DAYS).toBe(35);
  });

  it('a failed run changes nothing (one transaction)', async () => {
    const w = await mkWorld();
    await many(w, 3, {});
    await runCampusStats(run, DAY);
    const before = await snap(w);
    await many(w, 4, {});
    // A drive whose criteria column cannot be evaluated is not possible by constraint, so break the run another way.
    const failing: Run = (fn) => fn({ query: async (sql: string, p?: unknown[]) => (/FROM drives d JOIN campuses/.test(sql) ? Promise.reject(new Error('boom')) : c.query(sql, p)) } as never);
    await expect(runCampusStats(failing, DAY)).rejects.toThrow('boom');
    expect(await snap(w)).toEqual(before);
  });
});

describe('campus:stats drive evaluation', () => {
  const NOTICE = 'Eligibility: B.Tech 2026 batch with minimum 60% throughout and no active backlogs.';
  const publish = async (w: World, text = NOTICE): Promise<string> => {
    const id = randomUUID();
    await c.query("INSERT INTO drives (id, campus_id, cohort_id, title, notice_text, criteria) VALUES ($1, $2, $3, 'Acme drive', $4, $5::jsonb)", [id, w.campusId, w.cohortId, text, JSON.stringify(parseCriteria(text))]);
    return id;
  };
  const passing = { pct_10: 80, secondary_kind: '12th', pct_secondary: 78, grad_pct_equiv: 70, grad_scale: 100, grad_score: 70, active_backlogs: 0, passout_year: 2026, degree: 'B.Tech' };
  const failing = { ...passing, pct_secondary: 50, active_backlogs: 2 };

  it('stores each member\'s own verdict, counts eligible and unknown separately, and leaves placed members out', async () => {
    const w = await mkWorld();
    const pass = await many(w, 11, { profile: passing });
    const fail = await many(w, 10, { profile: failing });
    const unknown = await many(w, 10, {});
    const placed = await mkMember(w, { placed: true, profile: passing });
    const unverified = await mkMember(w, { via: 'code', profile: passing });
    const id = await publish(w);
    const r = await runCampusStats(run, DAY);
    expect(r.drives).toBeGreaterThanOrEqual(1);

    const verdicts = Object.fromEntries((await c.query('SELECT user_id, verdict FROM drive_checks WHERE drive_id = $1', [id])).rows.map((x) => [x.user_id, x.verdict]));
    expect(pass.every((u) => verdicts[u] === 'eligible')).toBe(true);
    expect(fail.every((u) => verdicts[u] === 'ineligible')).toBe(true);
    expect(unknown.every((u) => verdicts[u] === 'unknown')).toBe(true);
    expect(verdicts[placed]).toBeUndefined();
    expect(verdicts[unverified]).toBe('eligible'); // the member's own view is fine, but...

    const s = await snap(w);
    // ...the counts are verified members only: 11 eligible, 10 unknown, 10 ineligible out of 31.
    expect(s[`drive_eligible:${id}`]).toEqual([11, 31]);
    expect(s[`drive_unknown:${id}`]).toEqual([10, 31]);
    expect(s[`drive_ineligible:${id}`]).toEqual([10, 31]);
  });

  it('withholds a drive whose result differs from an earlier released drive by fewer than ten members, but not by none or by ten or more', async () => {
    const w = await mkWorld();
    await many(w, 12, { profile: passing }); // grad 70 passes every cutoff below
    await many(w, 3, { profile: { ...passing, grad_pct_equiv: 65, grad_score: 65 } }); // passes 60, fails 68
    const first = await publish(w, 'B.Tech 2026 batch. Minimum 60% in graduation.');
    const nested = await publish(w, 'B.Tech 2026 batch. Minimum 68% in graduation.'); // differs from the first for exactly 3 members
    const same = await publish(w, 'B.Tech 2026 batch. Minimum 60% in graduation, apply early.'); // identical result to the first
    await runCampusStats(run, DAY);
    const s = await snap(w);
    expect(s[`drive_eligible:${first}`]).toBeDefined();
    expect(s[`drive_eligible:${nested}`]).toBeUndefined(); // 3 members apart: differencing could isolate them
    expect(s[`drive_unknown:${nested}`]).toBeUndefined();
    expect(s[`drive_eligible:${same}`]).toBeDefined(); // zero apart reveals nothing new
    // The student's own verdict is untouched by the withholding.
    expect((await c.query('SELECT count(*)::int AS n FROM drive_checks WHERE drive_id = $1', [nested])).rows[0].n).toBe(15);
    // A TPO sees no counts for the withheld drive.
    const staff = await mkUser(c);
    await c.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, 'staff-box-2', 'staff', now())", [w.campusId, staff.id]);
    await c.query('BEGIN');
    try {
      await c.query('SET LOCAL ROLE hirelane_app');
      await c.query("SELECT set_config('hirelane.user_id', $1, true)", [staff.id]);
      expect((await c.query('SELECT tpo_drive_counts($1) AS r', [nested])).rows[0].r).toEqual({ day: null, metrics: [] });
    } finally {
      await c.query('ROLLBACK');
    }
  });

  it('compares with a drive that was closed after it was published: closing A and publishing a nested B does not defeat the check', async () => {
    const w = await mkWorld();
    await many(w, 12, { profile: passing });
    await many(w, 3, { profile: { ...passing, grad_pct_equiv: 65, grad_score: 65 } });
    const a = await publish(w, 'B.Tech 2026 batch. Minimum 60% in graduation.');
    await runCampusStats(run, DAY);
    expect((await snap(w))[`drive_eligible:${a}`]).toBeDefined();
    await c.query("UPDATE drives SET status = 'closed' WHERE id = $1", [a]);
    const b = await publish(w, 'B.Tech 2026 batch. Minimum 68% in graduation.');
    await runCampusStats(run, new Date('2026-10-30T02:20:00Z'));
    const day2 = await snap(w, '2026-10-30');
    expect(day2[`drive_eligible:${a}`]).toBeUndefined(); // closed drives are not counted again
    expect(day2[`drive_eligible:${b}`]).toBeUndefined(); // 3 members from A's published numbers
  });

  it('releases two drives that differ by ten or more members', async () => {
    const w = await mkWorld();
    await many(w, 12, { profile: passing });
    await many(w, 10, { profile: { ...passing, grad_pct_equiv: 65, grad_score: 65 } });
    const a = await publish(w, 'B.Tech 2026 batch. Minimum 60% in graduation.');
    const b = await publish(w, 'B.Tech 2026 batch. Minimum 68% in graduation.');
    await runCampusStats(run, DAY);
    const s = await snap(w);
    expect(s[`drive_eligible:${a}`]).toBeDefined();
    expect(s[`drive_eligible:${b}`]).toBeDefined();
  });

  it('leaves out of every drive population a member whose placed flag changed in the last day', async () => {
    const w = await mkWorld();
    await many(w, 12, { profile: passing });
    const flipped = await mkMember(w, { profile: passing });
    await c.query('UPDATE cohort_members SET placed_changed_at = now() WHERE user_id = $1', [flipped]);
    const id = await publish(w);
    await runCampusStats(run, DAY);
    expect((await snap(w))[`drive_eligible:${id}`]).toEqual([12, 12]);
    // After a day the member counts again.
    await c.query("UPDATE cohort_members SET placed_changed_at = now() - interval '2 days' WHERE user_id = $1", [flipped]);
    await runCampusStats(run, new Date('2026-10-30T02:20:00Z'));
    expect((await snap(w, '2026-10-30'))[`drive_eligible:${id}`]).toEqual([13, 13]);
  });

  it('applies the campus CGPA rule, so a CGPA-only profile passes where a percentage is needed', async () => {
    const w = await mkWorld({ kind: 'linear', a: 10, b: -7.5 });
    await many(w, 3, { profile: { grad_score: 8, grad_scale: 10, grad_conversion: 'campus:' + w.campusId, passout_year: 2026, degree: 'B.Tech', active_backlogs: 0, pct_10: 80, pct_secondary: 80 } });
    const id = await publish(w, 'B.Tech 2026 batch. Minimum 60% in graduation.');
    await runCampusStats(run, DAY);
    const rows = (await c.query('SELECT verdict FROM drive_checks WHERE drive_id = $1', [id])).rows.map((x) => x.verdict);
    expect(rows).toHaveLength(3);
    expect(rows.every((v) => v === 'eligible' || v === 'unknown')).toBe(true);
    expect(rows).not.toContain('ineligible');
  });

  it('closed drives are not evaluated; checks of members who left are removed', async () => {
    const w = await mkWorld();
    const [a, b] = await many(w, 2, { profile: passing });
    const id = await publish(w);
    await runCampusStats(run, DAY);
    expect((await c.query('SELECT 1 FROM drive_checks WHERE drive_id = $1', [id])).rowCount).toBe(2);
    await c.query('DELETE FROM cohort_members WHERE user_id = $1', [a]);
    await c.query("UPDATE drives SET status = 'closed' WHERE id = $1", [id]);
    await runCampusStats(run, new Date('2026-10-30T02:20:00Z'));
    const left = (await c.query('SELECT user_id FROM drive_checks WHERE drive_id = $1', [id])).rows.map((x) => x.user_id);
    expect(left).toEqual([b]);
    expect(await snap(w, '2026-10-30')).not.toHaveProperty(`drive_eligible:${id}`);
  });

  it('a TPO reads the result only through the definer functions: suppressed, rounded, latest day', async () => {
    const w = await mkWorld();
    await many(w, 31, { profile: passing, resume: 'readable' });
    await many(w, 3, { profile: failing, resume: 'readable' });
    await many(w, 12, { resume: 'none' });
    await many(w, 10, {});
    const id = await publish(w);
    const staff = await mkUser(c);
    await c.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, 'staff-box', 'staff', now())", [w.campusId, staff.id]);
    await runCampusStats(run, DAY);

    await c.query('BEGIN');
    try {
      await c.query('SET LOCAL ROLE hirelane_app');
      await c.query("SELECT set_config('hirelane.user_id', $1, true)", [staff.id]);
      const stats = (await c.query('SELECT tpo_cohort_stats($1) AS r', [w.cohortId])).rows[0].r;
      const by = Object.fromEntries(stats.metrics.map((m: { metric: string }) => [m.metric, m]));
      expect(stats.day).toBe('2026-10-29');
      expect(by.joined_verified).toMatchObject({ value: 55, suppressed: false }); // 56 rounds to 55
      expect(by.stage_confirmed).toMatchObject({ value: 35, suppressed: false }); // 34
      expect(by.stage_resume_unconfirmed).toMatchObject({ value: 10, suppressed: false }); // 12
      expect(by.stage_no_resume).toMatchObject({ value: 10, suppressed: false }); // 10
      expect(by.blocker_active_backlog.suppressed).toBe(true); // 3 of 34
      expect(by.ats_readable).toMatchObject({ value: 35, suppressed: false }); // 34 of 46
      const counts = (await c.query('SELECT tpo_drive_counts($1) AS r', [id])).rows[0].r;
      const dc = Object.fromEntries(counts.metrics.map((m: { metric: string }) => [m.metric, m]));
      expect(dc.drive_ineligible.suppressed).toBe(true); // 3 failing, under k
      expect(dc.drive_unknown.suppressed).toBe(true); // 22: complementary, the smaller of the other two
      expect(dc.drive_eligible).toMatchObject({ value: 30, suppressed: false }); // 31
    } finally {
      await c.query('ROLLBACK');
    }
  });
});

describe('profile mapping and registration', () => {
  it('maps a pg row (numerics as strings) to the engine input, and only when confirmed', () => {
    expect(profileInput(null)).toBeNull();
    expect(profileInput({ confirmed_at: null })).toBeNull();
    expect(profileInput({ confirmed_at: new Date(), pct_10: '82.50', grad_scale: 10, grad_score: '8.10', active_backlogs: 0, degree: 'B.Tech', board_10: null })).toEqual({
      confirmed: true,
      pct_10: 82.5,
      grad_scale: 10,
      grad_score: 8.1,
      active_backlogs: 0,
      degree: 'B.Tech',
    });
  });

  it('verdict words match the drive_checks CHECK', () => {
    expect([verdictOf('pass'), verdictOf('fail'), verdictOf('unknown')]).toEqual(['eligible', 'ineligible', 'unknown']);
  });

  it('is registered as a task and scheduled nightly', () => {
    expect(Object.keys(taskList)).toContain('campus:stats');
    expect(Object.keys(createCampusStatsTasks())).toEqual(['campus:stats']);
    const cron = parseCrontab(readFileSync(resolve(import.meta.dirname, '../crontab'), 'utf8'));
    const item = cron.find((i) => i.task === 'campus:stats');
    expect(item).toBeDefined();
    const fires = (min: number, hour: number) => item!.match({ min, hour, date: 29, month: 10, dow: 4 });
    expect(fires(20, 2)).toBe(true);
    expect(fires(21, 2)).toBe(false);
    expect(fires(20, 3)).toBe(false);
  });

  it('the task runs with injected deps and logs counts only', async () => {
    const logs: string[] = [];
    const tasks = createCampusStatsTasks({ run, now: () => DAY });
    await (tasks['campus:stats'] as (p: unknown, h: unknown) => Promise<void>)({}, { logger: { info: (m: string) => logs.push(m) } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^campus:stats cohorts \d+ drives \d+ checks \d+ pruned \d+$/);
  });
});
