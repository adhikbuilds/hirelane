import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { mkJob } from './apply-helpers.js';
import { mkUser } from './auth-helpers.js';
import { freshTestClient } from './helpers.js';

/**
 * 0014 pilot blockers (docs/apply.md "Open before pilot"). Synthetic data only.
 *   - reads that do not write (items 3 and 8 of that list)
 *   - roster import and drive publishing need a write role (item 6)
 *   - a draft suggestion lives only on a needs_you answer (item 1)
 */
let c: Client;
beforeAll(async () => {
  c = await freshTestClient();
  await applyMigrations(c, resolve(import.meta.dirname, '../migrations'));
});
afterAll(async () => {
  await c.end();
});

type Q = (sql: string, p?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
/** `readOnly` runs the whole transaction READ ONLY: any write, including a log row or an invite claim, fails with 25006. */
async function as<T>(userId: string, fn: (q: Q) => Promise<T>, readOnly = false): Promise<T> {
  await c.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
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
const fn = async (userId: string, name: string, args: unknown[] = [], readOnly = false): Promise<any> =>
  as(userId, async (q) => (await q(`SELECT ${name}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS r`, args)).rows[0].r, readOnly);
const errCode = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

interface World {
  campusId: string;
  cohortId: string;
  domain: string;
}
async function mkCampus(): Promise<World> {
  const campusId = randomUUID();
  const cohortId = randomUUID();
  const domain = `college-${campusId.slice(0, 8)}.example.test`;
  await c.query('INSERT INTO campuses (id, name, code_hmac) VALUES ($1, $2, $3)', [campusId, `Test College ${campusId.slice(0, 6)}`, `code-${randomUUID()}`]);
  await c.query('INSERT INTO campus_domains (campus_id, domain) VALUES ($1, $2)', [campusId, domain]);
  await c.query('INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2026, $3)', [cohortId, campusId, 'B.Tech CSE']);
  return { campusId, cohortId, domain };
}
async function mkMember(w: World, share = 'full'): Promise<string> {
  const u = await mkUser(c);
  await c.query(
    `INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac, share_level) VALUES ($1, $2, $3, 'email', now(), $4, $5)`,
    [u.id, w.campusId, w.cohortId, `m-${u.id}`, share],
  );
  return u.id;
}
async function mkStaff(w: World, role: 'owner' | 'staff' = 'owner'): Promise<string> {
  const u = await mkUser(c);
  await c.query('INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, $3, $4, now())', [w.campusId, u.id, `staff-${u.id}`, role]);
  return u.id;
}
const logRows = async (campusId: string): Promise<number> => (await c.query('SELECT count(*)::int AS n FROM tpo_access_log WHERE campus_id = $1', [campusId])).rows[0].n;
async function reportOffer(w: World, userId: string, employer: string): Promise<void> {
  await c.query("INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer, package_lpa) VALUES ($1, $2, $3, 'offer', $4, 6)", [userId, w.campusId, w.cohortId, employer]);
}

describe('GET views do not write (decision 2026-10-31: reads are side-effect free)', () => {
  it('tpo_peek_outcomes writes nothing, withholds names and emails, and runs in a READ ONLY transaction', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const student = await mkMember(w, 'full');
    await c.query("UPDATE users SET display_name = 'Asha Test' WHERE id = $1", [student]);
    await reportOffer(w, student, 'Acme');
    const before = await logRows(w.campusId);
    const rows = await fn(staff, 'tpo_peek_outcomes', [w.campusId, null], true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employer: 'Acme', kind: 'offer', studentName: null, studentEmail: null });
    expect(JSON.stringify(rows)).not.toContain('Asha');
    expect(JSON.stringify(rows)).not.toContain('example.test');
    expect(await logRows(w.campusId)).toBe(before);
  });

  it('the logging functions still log and cannot run READ ONLY, which proves the split is real', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const student = await mkMember(w, 'outcomes');
    await reportOffer(w, student, 'Acme');
    expect(await errCode(fn(staff, 'tpo_list_outcomes', [w.campusId, null], true))).toBe('25006');
    expect(await errCode(fn(staff, 'tpo_naac_rows', [w.campusId, null], true))).toBe('25006');
    expect(await logRows(w.campusId)).toBe(0);
    await fn(staff, 'tpo_list_outcomes', [w.campusId, null]);
    await fn(staff, 'tpo_naac_rows', [w.campusId, null]);
    // The student's log is correct: one row per disclosure, each visible to them.
    const seen = await as(student, async (q) => (await q('SELECT action FROM tpo_access_log ORDER BY action')).rows.map((r) => r.action));
    expect(seen).toEqual(['naac_export', 'outcomes_list']);
  });

  it('tpo_naac_count returns a number only, writes nothing, and is NULL for non-staff', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'owner');
    const stranger = await mkStaff(await mkCampus(), 'owner');
    const a = await mkMember(w, 'outcomes');
    const b = await mkMember(w, 'aggregate');
    await reportOffer(w, a, 'Acme');
    await reportOffer(w, b, 'Hidden');
    expect(await fn(staff, 'tpo_naac_count', [w.campusId, null], true)).toEqual({ rows: 1, placements: 1, higherEd: 0 });
    expect(await fn(staff, 'tpo_naac_count', [w.campusId, 2030], true)).toEqual({ rows: 0, placements: 0, higherEd: 0 });
    // A higher-studies record under the same consent filter counts too; one the student keeps private does not.
    await c.query("INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer) VALUES ($1, $2, $3, 'higher_studies', 'Test Institute')", [a, w.campusId, w.cohortId]);
    await c.query("INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer) VALUES ($1, $2, $3, 'higher_studies', 'Private Institute')", [b, w.campusId, w.cohortId]);
    expect(await fn(staff, 'tpo_naac_count', [w.campusId, null], true)).toEqual({ rows: 2, placements: 1, higherEd: 1 });
    expect(await fn(stranger, 'tpo_naac_count', [w.campusId, null], true)).toBeNull();
    expect(await fn(stranger, 'tpo_peek_outcomes', [w.campusId, null], true)).toBeNull();
    expect(await logRows(w.campusId)).toBe(0);
  });

  it('tpo_has_pending_invite is a read: true for a live invite on my verified mailbox, false after a claim, expiry or for another mailbox', async () => {
    const w = await mkCampus();
    const owner = await mkStaff(w, 'owner');
    await c.query('INSERT INTO tpo_members (campus_id, email_hmac, role, invited_by) VALUES ($1, $2, $3, $4)', [w.campusId, 'box-live', 'staff', owner]);
    await c.query("INSERT INTO tpo_members (campus_id, email_hmac, role, invited_by, expires_at) VALUES ($1, $2, 'staff', $3, now() - interval '1 day')", [w.campusId, 'box-old', owner]);
    const me = (await mkUser(c)).id;
    expect(await fn(me, 'tpo_has_pending_invite', ['box-live'], true)).toBe(true);
    expect(await fn(me, 'tpo_has_pending_invite', ['box-old'], true)).toBe(false);
    expect(await fn(me, 'tpo_has_pending_invite', ['box-other'], true)).toBe(false);
    // it did not claim: the seat is still open, and a real claim still works once
    expect((await c.query('SELECT user_id FROM tpo_members WHERE email_hmac = $1', ['box-live'])).rows[0].user_id).toBeNull();
    expect(await fn(me, 'tpo_claim_invites', ['box-live'])).toBe(1);
    expect(await fn(me, 'tpo_has_pending_invite', ['box-live'], true)).toBe(false);
  });

  it('an unverified account never sees an invite as pending', async () => {
    const w = await mkCampus();
    const owner = await mkStaff(w, 'owner');
    await c.query('INSERT INTO tpo_members (campus_id, email_hmac, role, invited_by) VALUES ($1, $2, $3, $4)', [w.campusId, 'box-unv', 'staff', owner]);
    const u = await mkUser(c);
    await c.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [u.id]);
    expect(await fn(u.id, 'tpo_has_pending_invite', ['box-unv'], true)).toBe(false);
  });
});

describe('roster import and drive publishing need a write role: owner or officer, never a viewer', () => {
  const tenRows = (w: World) => JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ h: `h-${randomUUID()}-${i}`, d: w.domain, placed: false })));

  it.each(['owner', 'staff'] as const)('a claimed %s seat can import a roster and publish a drive', async (role) => {
    const w = await mkCampus();
    const who = await mkStaff(w, role);
    expect((await fn(who, 'tpo_import_roster', [w.cohortId, tenRows(w), 10, 0])).status).toBe('imported');
    expect(await fn(who, 'tpo_publish_drive', [w.cohortId, 'Drive', null, 'Open to all.', '[]', '[]', 'none'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a student, another campus\'s staff and an unclaimed invite get NULL (a 404), and write nothing', async () => {
    const w = await mkCampus();
    const student = await mkMember(w);
    const stranger = await mkStaff(await mkCampus(), 'owner');
    for (const who of [student, stranger]) {
      expect(await fn(who, 'tpo_import_roster', [w.cohortId, tenRows(w), 10, 0])).toBeNull();
      expect(await fn(who, 'tpo_publish_drive', [w.cohortId, 'x', null, 'n', '[]', '[]', 'none'])).toBeNull();
    }
    expect((await c.query('SELECT count(*)::int AS n FROM cohort_roster WHERE cohort_id = $1', [w.cohortId])).rows[0].n).toBe(0);
    expect((await c.query('SELECT count(*)::int AS n FROM drives WHERE cohort_id = $1', [w.cohortId])).rows[0].n).toBe(0);
  });

  it('there is no viewer role: the CHECK refuses one', async () => {
    const w = await mkCampus();
    const u = await mkUser(c);
    expect(await errCode(c.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, 'v', 'viewer', now())", [w.campusId, u.id]))).toBe('23514');
  });

  it('the gate fails closed for any role it does not name (a viewer slipped in past the CHECK is refused with 42501 and nothing is written)', async () => {
    const w = await mkCampus();
    const viewer = await mkStaff(w, 'staff');
    await c.query('BEGIN');
    try {
      await c.query('ALTER TABLE tpo_members DROP CONSTRAINT tpo_members_role');
      await c.query("UPDATE tpo_members SET role = 'viewer' WHERE user_id = $1", [viewer]);
      for (const sql of [
        ['SELECT tpo_import_roster($1, $2::jsonb, 10, 0)', [w.cohortId, tenRows(w)]],
        ["SELECT tpo_publish_drive($1, 't', null, 'n', '[]', '[]', 'none')", [w.cohortId]],
      ] as const) {
        await c.query('SAVEPOINT s');
        await c.query('SET LOCAL ROLE hirelane_app');
        await c.query("SELECT set_config('hirelane.user_id', $1, true)", [viewer]);
        let code: string | undefined;
        try {
          await c.query(sql[0], [...sql[1]]);
        } catch (e) {
          code = (e as { code?: string }).code;
        }
        await c.query('ROLLBACK TO SAVEPOINT s');
        await c.query('RESET ROLE');
        expect(code, sql[0]).toBe('42501');
      }
      expect((await c.query('SELECT count(*)::int AS n FROM cohort_roster WHERE cohort_id = $1', [w.cohortId])).rows[0].n).toBe(0);
      expect((await c.query('SELECT count(*)::int AS n FROM drives WHERE cohort_id = $1', [w.cohortId])).rows[0].n).toBe(0);
    } finally {
      await c.query('ROLLBACK');
    }
  });

  it('reading is not writing: the same unlisted role could still read stats and drives, and the existing read functions are unchanged', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    expect(await fn(staff, 'tpo_list_cohorts', [w.campusId], true)).toHaveLength(1);
  });
});

describe('a draft suggestion belongs to a needs_you answer only', () => {
  it('is stored on a needs_you row, refused on a filled one, and the student reads it', async () => {
    const u = await mkUser(c);
    const { jobId } = await mkJob(c);
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE hirelane_app');
    await c.query("SELECT set_config('hirelane.user_id', $1, true)", [u.id]);
    const id = (await c.query('INSERT INTO applications (user_id, job_id) VALUES ($1, $2) RETURNING id', [u.id, jobId])).rows[0].id as string;
    await c.query('COMMIT');
    await c.query("UPDATE applications SET undo_until = now() - interval '1 minute' WHERE id = $1", [id]);
    await c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]);
    const ins = (cols: string, vals: string) => c.query(`INSERT INTO application_answers (application_id, user_id, field_id, label, ${cols}) VALUES ($1, $2, $3, 'Why us', ${vals})`, [id, u.id, randomUUID()]);
    expect(await errCode(ins('needs_you, reason, suggestion_enc', "true, 'confirm_draft', '\\x01'"))).toBeUndefined();
    const filled = await ins('needs_you, answer_enc, evidence_enc, evidence_sources, suggestion_enc', "false, '\\x01', '\\x02', '{profile:email}', '\\x03'").catch((e) => e as { constraint?: string });
    expect((filled as { constraint?: string }).constraint).toBe('application_answers_suggestion_needs_you');
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE hirelane_app');
    await c.query("SELECT set_config('hirelane.user_id', $1, true)", [u.id]);
    const seen = (await c.query('SELECT suggestion_enc FROM application_answers WHERE application_id = $1', [id])).rows;
    await c.query('COMMIT');
    expect(seen).toHaveLength(1);
    expect(seen[0].suggestion_enc).not.toBeNull();
  });
});
