import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { mkUser } from './auth-helpers.js';
import { freshTestClient } from './helpers.js';

/** 0015: drive drafts and lifecycle, staff-only scam flags, notifications, preferences and the unsubscribe door. Synthetic data only. */
let c: Client;
beforeAll(async () => {
  c = await freshTestClient();
  await applyMigrations(c, resolve(import.meta.dirname, '../migrations'));
});
afterAll(async () => {
  await c.end();
});

type Q = (sql: string, p?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
async function as<T>(userId: string, fn: (q: Q) => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    await c.query('SET LOCAL ROLE hirelane_app');
    await c.query("SELECT set_config('hirelane.user_id', $1, true)", [userId]);
    const out = await fn((sql, p) => c.query(sql, p) as never);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
}
const rows = async (userId: string, sql: string, p: unknown[] = []): Promise<any[]> => as(userId, async (q) => (await q(sql, p)).rows);
const fn = async (userId: string, name: string, ...args: unknown[]): Promise<any> =>
  (await rows(userId, `SELECT ${name}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS r`, args))[0].r;
const code = async (userId: string, sql: string, p: unknown[] = []): Promise<string | undefined> => {
  try {
    await as(userId, (q) => q(sql, p));
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

interface World {
  campusId: string;
  cohortId: string;
}
async function mkCampus(): Promise<World> {
  const campusId = randomUUID();
  const cohortId = randomUUID();
  await c.query('INSERT INTO campuses (id, name, code_hmac) VALUES ($1, $2, $3)', [campusId, `Test College ${campusId.slice(0, 6)}`, `code-${randomUUID()}`]);
  await c.query('INSERT INTO campus_domains (campus_id, domain) VALUES ($1, $2)', [campusId, `college-${campusId.slice(0, 8)}.example.test`]);
  await c.query("INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2026, 'B.Tech CSE')", [cohortId, campusId]);
  return { campusId, cohortId };
}
async function mkMember(w: World, share = 'aggregate'): Promise<string> {
  const u = await mkUser(c);
  await c.query(
    `INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac, share_level) VALUES ($1, $2, $3, 'email', now(), $4, $5)`,
    [u.id, w.campusId, w.cohortId, `m-${u.id}`, share],
  );
  return u.id;
}
async function mkStaff(w: World): Promise<string> {
  const u = await mkUser(c);
  await c.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, $3, 'owner', now())", [w.campusId, u.id, `staff-${u.id}`]);
  return u.id;
}
const create = (staff: string, w: World, o: { title?: string; announce?: boolean; deadline?: string | null; flags?: string; risk?: string } = {}): Promise<string | null> =>
  fn(staff, 'tpo_create_drive', w.cohortId, o.title ?? 'Drive', null, 'Open to all.', '[]', o.flags ?? '[]', o.risk ?? 'none', o.deadline ?? null, 'Aptitude, then HR', 'Marksheets', o.announce ?? false);
const listed = async (staff: string, w: World): Promise<any[]> => fn(staff, 'tpo_list_drives', w.campusId);

describe('drive lifecycle: draft, live, closed', () => {
  it('a draft is listed for staff as draft and is invisible to students; announcing makes it live and visible', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkMember(w);
    const id = (await create(staff, w, { title: 'Draft one', deadline: '2099-01-31' }))!;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await listed(staff, w))[0]).toMatchObject({ id, status: 'draft', deadline: '2099-01-31', rounds: 'Aptitude, then HR', documents: 'Marksheets', announcedAt: null });
    expect(await rows(student, 'SELECT id FROM drives')).toEqual([]);

    expect(await fn(staff, 'tpo_announce_drive', id)).toBe(true);
    expect((await listed(staff, w))[0]).toMatchObject({ id, status: 'live' });
    expect((await rows(student, 'SELECT id, deadline::text AS deadline FROM drives')).map((r) => r.id)).toEqual([id]);
    expect(await fn(staff, 'tpo_announce_drive', id)).toBe(false); // already live: nothing changes
  });

  it('the nightly job still evaluates a draft: its stored status is published, so the reach can be read before announcing', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const id = (await create(staff, w))!;
    expect((await c.query('SELECT status FROM drives WHERE id = $1', [id])).rows[0].status).toBe('published');
    for (const m of ['eligible', 'unknown', 'ineligible']) {
      await c.query('INSERT INTO cohort_stats_daily (cohort_id, day, metric, n, p) VALUES ($1, current_date, $2, $3, 100)', [w.cohortId, `drive_${m}:${id}`, m === 'eligible' ? 60 : m === 'unknown' ? 30 : 10]);
    }
    const counts = await fn(staff, 'tpo_drive_counts', id);
    expect(counts.metrics.find((m: any) => m.metric === 'drive_eligible')).toMatchObject({ value: 60, suppressed: false });
  });

  it('closing is staff only and hides the drive from students', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkMember(w);
    const id = (await create(staff, w, { announce: true }))!;
    expect((await rows(student, 'SELECT id FROM drives')).length).toBe(1);
    expect(await fn(student, 'tpo_close_drive', id)).toBeNull();
    expect(await fn(await mkStaff(await mkCampus()), 'tpo_close_drive', id)).toBeNull();
    expect(await fn(staff, 'tpo_close_drive', id)).toBe(true);
    expect((await listed(staff, w))[0]).toMatchObject({ id, status: 'closed' });
    expect(await rows(student, 'SELECT id FROM drives')).toEqual([]);
    expect(await fn(staff, 'tpo_close_drive', id)).toBe(false);
  });

  it('a live drive whose deadline has passed is listed as closed', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    await create(staff, w, { announce: true, deadline: '2020-01-01' });
    expect((await listed(staff, w))[0].status).toBe('closed');
  });

  it('only staff of the campus can create or announce; others get NULL', async () => {
    const w = await mkCampus();
    const student = await mkMember(w);
    expect(await create(student, w)).toBeNull();
    const id = (await create(await mkStaff(w), w))!;
    expect(await fn(student, 'tpo_announce_drive', id)).toBeNull();
    expect(await fn(await mkStaff(await mkCampus()), 'tpo_announce_drive', id)).toBeNull();
  });

  it('drafts count toward the cap of 10 drives per cohort in 30 days', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    for (let i = 0; i < 10; i++) expect(await create(staff, w, { title: `d${i}` })).toMatch(/^[0-9a-f-]{36}$/);
    expect(await code(staff, 'SELECT tpo_create_drive($1, $2, NULL, $3, $4::jsonb, $5::jsonb, $6, NULL, NULL, NULL, false)', [w.cohortId, 'd11', 'n', '[]', '[]', 'none'])).toBe('23514');
  });

  it('scam flags and risk are not readable by a student session, even by naming the column; the rest of the drive is', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkMember(w);
    await create(staff, w, { announce: true, risk: 'high', flags: '[{"id":"fee","severity":"high","quote":"pay","source":"text"}]' });
    expect(await code(student, 'SELECT scam_flags FROM drives')).toBe('42501');
    expect(await code(student, 'SELECT scam_risk FROM drives')).toBe('42501');
    expect(await code(student, 'SELECT created_by FROM drives')).toBe('42501');
    const r = (await rows(student, 'SELECT title, deadline, rounds, documents FROM drives'))[0];
    expect(r).toMatchObject({ title: 'Drive', rounds: 'Aptitude, then HR', documents: 'Marksheets' });
    expect((await listed(staff, w))[0]).toMatchObject({ scamRisk: 'high' });
  });
});

describe('notifications', () => {
  const offer = async (w: World, user: string, kind = 'offer'): Promise<string> => {
    const id = randomUUID();
    await c.query("INSERT INTO outcomes (id, user_id, campus_id, cohort_id, kind, employer) VALUES ($1, $2, $3, $4, $5, 'Acme Test Co')", [id, user, w.campusId, w.cohortId, kind]);
    return id;
  };

  it('verifying an offer writes a Home row for that student, pending email, once', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkMember(w, 'outcomes');
    const bystander = await mkMember(w, 'outcomes');
    const id = await offer(w, student);
    expect(await fn(staff, 'tpo_verify_outcome', id)).toMatchObject({ verification: 'tpo_verified' });
    await fn(staff, 'tpo_verify_outcome', id);
    const mine = await rows(student, "SELECT kind, title, email_state, outcome_id FROM notifications WHERE kind = 'outcome_verified'");
    expect(mine).toEqual([{ kind: 'outcome_verified', title: 'Your offer from Acme Test Co was verified by your placement cell', email_state: 'pending', outcome_id: id }]);
    expect(await rows(bystander, 'SELECT id FROM notifications')).toEqual([]);
  });

  it('an interview verification is not an offer-verified notification', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkMember(w, 'outcomes');
    await fn(staff, 'tpo_verify_outcome', await offer(w, student, 'interview'));
    expect(await rows(student, 'SELECT id FROM notifications')).toEqual([]);
  });

  it('a student cannot write notifications, only mark their own read', async () => {
    const w = await mkCampus();
    const student = await mkMember(w);
    expect(await code(student, "INSERT INTO notifications (user_id, kind, title) VALUES ($1, 'drive_published', 'x')", [student])).toBe('42501');
  });

  it('the kinds are closed and one event notifies a student once', async () => {
    const u = await mkUser(c);
    await expect(c.query("INSERT INTO notifications (user_id, kind, title) VALUES ($1, 'spam', 'x')", [u.id])).rejects.toMatchObject({ code: '23514' });
    await c.query("INSERT INTO notifications (user_id, kind, title, dedupe_key) VALUES ($1, 'drive_closing', 'x', 'k1')", [u.id]);
    await expect(c.query("INSERT INTO notifications (user_id, kind, title, dedupe_key) VALUES ($1, 'drive_closing', 'x', 'k1')", [u.id])).rejects.toMatchObject({ code: '23505' });
    // rows that existed before 0015 default to skipped, so the sweep never mails them
    const old = await c.query("INSERT INTO notifications (user_id, kind, title) VALUES ($1, 'employer_message', 'old') RETURNING email_state", [u.id]);
    expect(old.rows[0].email_state).toBe('skipped');
  });
});

describe('notification preferences and the unsubscribe door', () => {
  it('a student sets email on or off for the two non-critical kinds, and only their own', async () => {
    const a = (await mkUser(c)).id;
    const b = (await mkUser(c)).id;
    await as(a, (q) => q("INSERT INTO notification_prefs (user_id, kind, email) VALUES ($1, 'drive_published', false)", [a]));
    expect(await code(b, "INSERT INTO notification_prefs (user_id, kind, email) VALUES ($1, 'drive_published', false)", [a])).toBe('42501');
    expect((await rows(b, 'SELECT * FROM notification_prefs')).length).toBe(0);
    expect((await rows(a, 'SELECT kind, email FROM notification_prefs'))).toEqual([{ kind: 'drive_published', email: false }]);
  });

  it('critical kinds have no preference row to set', async () => {
    const a = (await mkUser(c)).id;
    for (const kind of ['employer_reply', 'outcome_verified']) {
      expect(await code(a, 'INSERT INTO notification_prefs (user_id, kind, email) VALUES ($1, $2, false)', [a, kind])).toBe('23514');
    }
  });

  it('a valid token hash turns email off for every non-critical kind; an unknown one changes nothing; the table is unreadable to the app', async () => {
    const a = (await mkUser(c)).id;
    const b = (await mkUser(c)).id;
    const token = 'tok-' + randomUUID();
    const hash = createHash('sha256').update(token).digest('hex');
    await c.query('INSERT INTO notification_unsub (user_id, token_hash) VALUES ($1, $2)', [a, hash]);
    expect(await code(a, 'SELECT 1 FROM notification_unsub')).toBe('42501');

    const nobody = '00000000-0000-0000-0000-000000000000';
    expect(await fn(nobody, 'notify_unsubscribe', createHash('sha256').update('wrong').digest('hex'))).toBe(0);
    expect((await c.query('SELECT count(*)::int AS n FROM notification_prefs WHERE user_id = ANY($1::uuid[])', [[a, b]])).rows[0].n).toBe(0);

    expect(await fn(nobody, 'notify_unsubscribe', hash)).toBe(2);
    expect(await fn(nobody, 'notify_unsubscribe', hash)).toBe(2); // repeating is harmless
    expect((await rows(a, 'SELECT kind, email FROM notification_prefs ORDER BY kind'))).toEqual([
      { kind: 'drive_closing', email: false },
      { kind: 'drive_published', email: false },
    ]);
    expect((await rows(b, 'SELECT * FROM notification_prefs')).length).toBe(0);
  });
});
