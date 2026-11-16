import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { mkUser } from './auth-helpers.js';
import { freshTestClient } from './helpers.js';

/** 0011 / 0011a: campus tables and the SECURITY DEFINER doors. Synthetic data only. */
let c: Client;
beforeAll(async () => {
  c = await freshTestClient();
  await applyMigrations(c, resolve(import.meta.dirname, '../migrations'));
});
afterAll(async () => {
  await c.end();
});

type Q = (sql: string, p?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;

/** Runs `fn` as the app role with the user context set, committed. A thrown error rolls back and is returned as `{ error }`. */
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
const call = async (userId: string, sql: string, p: unknown[] = []): Promise<any> => as(userId, async (q) => (await q(sql, p)).rows[0]);
const fn = async (userId: string, name: string, ...args: unknown[]): Promise<any> => {
  const row = await call(userId, `SELECT ${name}(${args.map((_, i) => `$${i + 1}`).join(', ')}) AS r`, args);
  return row.r;
};
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
  codeHmac: string;
  domain: string;
}
async function mkCampus(extra: { domain?: string; programme?: string } = {}): Promise<World> {
  const campusId = randomUUID();
  const cohortId = randomUUID();
  const codeHmac = `code-${randomUUID()}`;
  const domain = extra.domain ?? `college-${campusId.slice(0, 8)}.example.test`;
  await c.query('INSERT INTO campuses (id, name, code_hmac) VALUES ($1, $2, $3)', [campusId, `Test College ${campusId.slice(0, 6)}`, codeHmac]);
  await c.query('INSERT INTO campus_domains (campus_id, domain) VALUES ($1, $2)', [campusId, domain]);
  await c.query('INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2026, $3)', [cohortId, campusId, extra.programme ?? 'B.Tech CSE']);
  return { campusId, cohortId, codeHmac, domain };
}
async function mkMember(w: World, opts: { via?: 'code' | 'email' | 'roster'; share?: string; mail?: string } = {}): Promise<string> {
  const u = await mkUser(c);
  const via = opts.via ?? 'email';
  await c.query(
    `INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac, share_level)
     VALUES ($1, $2, $3, $4, ${via === 'code' ? 'NULL' : 'now()'}, $5, $6)`,
    [u.id, w.campusId, w.cohortId, via, via === 'code' ? null : (opts.mail ?? `m-${u.id}`), opts.share ?? 'aggregate'],
  );
  return u.id;
}
async function mkStaff(w: World, role: 'owner' | 'staff' = 'owner'): Promise<string> {
  const u = await mkUser(c);
  await c.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, $3, $4, now())", [w.campusId, u.id, `staff-${u.id}`, role]);
  return u.id;
}

describe('campus_release_cells: k = 10, complementary suppression, rounding to 5', () => {
  const release = async (cells: unknown[]) => (await c.query('SELECT campus_release_cells($1::jsonb) AS r', [JSON.stringify(cells)])).rows[0].r as { metric: string; value: number | null; suppressed: boolean }[];

  it('hides a cell with n < 10 or P - n < 10 and rounds the rest to the nearest 5', async () => {
    const r = await release([
      { metric: 'a', n: 9, p: 100 },
      { metric: 'b', n: 10, p: 100 },
      { metric: 'c', n: 91, p: 100 },
      { metric: 'd', n: 90, p: 100 },
      { metric: 'e', n: 47, p: 100 },
      { metric: 'f', n: 48, p: 100 },
    ]);
    expect(r.map((x) => [x.metric, x.suppressed, x.value])).toEqual([
      ['a', true, null],
      ['b', false, 10],
      ['c', true, null],
      ['d', false, 90],
      ['e', false, 45],
      ['f', false, 50],
    ]);
  });

  it('a total cell is hidden only below k, and never leaks a value under k', async () => {
    const r = await release([{ metric: 't', n: 9, p: 9, total: true }, { metric: 'u', n: 12, p: 12, total: true }]);
    expect(r[0]).toMatchObject({ suppressed: true, value: null });
    expect(r[1]).toMatchObject({ suppressed: false, value: 10 });
  });

  it('one hidden cell in an exclusive group hides the smallest other one too, so it cannot be rebuilt from the total', async () => {
    const r = await release([
      { metric: 'x', n: 3, p: 100, group: 'g' },
      { metric: 'y', n: 40, p: 100, group: 'g' },
      { metric: 'z', n: 57, p: 100, group: 'g' },
    ]);
    expect(r.map((x) => x.suppressed)).toEqual([true, true, false]);
    // 3 + 40 is only known as a sum. No released number identifies either of them.
    expect(r[2]!.value).toBe(55);
  });

  it('two hidden cells need no extra hiding, and a group of unhidden cells is left alone', async () => {
    const two = await release([
      { metric: 'x', n: 3, p: 100, group: 'g' },
      { metric: 'y', n: 4, p: 100, group: 'g' },
      { metric: 'z', n: 93, p: 100, group: 'g' },
    ]);
    expect(two.map((x) => x.suppressed)).toEqual([true, true, true]);
    const none = await release([
      { metric: 'x', n: 30, p: 100, group: 'g' },
      { metric: 'y', n: 70, p: 100, group: 'g' },
    ]);
    expect(none.map((x) => x.suppressed)).toEqual([false, false]);
  });

  it('property: over random exclusive groups no hidden cell can be recovered from the released values and the total', async () => {
    let seed = 7;
    const rnd = (m: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % m);
    for (let round = 0; round < 60; round++) {
      const parts = 2 + rnd(4);
      const ns = Array.from({ length: parts }, () => (rnd(3) === 0 ? rnd(12) : 10 + rnd(60)));
      const p = ns.reduce((a, b) => a + b, 0);
      const r = await release(ns.map((n, i) => ({ metric: `m${i}`, n, p, group: 'g' })));
      const hidden = r.filter((x) => x.suppressed).length;
      // Hidden cells are never exactly one: either none (nothing to recover) or at least two (only their sum is derivable).
      expect(hidden === 0 || hidden >= 2, JSON.stringify({ ns, r })).toBe(true);
      for (const x of r) if (x.suppressed) expect(x.value).toBeNull();
      for (const [i, x] of r.entries()) if (!x.suppressed) expect(Math.abs((x.value as number) - ns[i]!)).toBeLessThanOrEqual(2);
    }
  });
});

describe('column grants and RLS on the member tables', () => {
  it('a student can change their share level and nothing else on their membership', async () => {
    const w = await mkCampus();
    const u = await mkMember(w, { via: 'code' });
    expect(await code(u, "UPDATE cohort_members SET share_level = 'outcomes' WHERE user_id = $1", [u])).toBeUndefined();
    expect((await call(u, 'SELECT share_level FROM cohort_members WHERE user_id = $1', [u])).share_level).toBe('outcomes');
    for (const col of ["verified_via = 'email'", 'verified_at = now()', 'placed = true', "email_hmac = 'x'", `cohort_id = '${randomUUID()}'`, `campus_id = '${randomUUID()}'`]) {
      expect(await code(u, `UPDATE cohort_members SET ${col} WHERE user_id = $1`, [u]), col).toBe('42501');
    }
    expect(await code(u, "UPDATE cohort_members SET share_level = 'everything' WHERE user_id = $1", [u])).toBe('23514');
  });

  it('a student cannot insert, delete, or read another campus', async () => {
    const w1 = await mkCampus();
    const w2 = await mkCampus();
    const u1 = await mkMember(w1);
    const u2 = await mkMember(w2);
    expect(await code(u1, "INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via) VALUES ($1, $2, $3, 'code')", [u1, w1.campusId, w1.cohortId])).toBe('42501');
    expect(await code(u1, 'DELETE FROM cohort_members WHERE user_id = $1', [u1])).toBe('42501');
    const seen = await as(u1, async (q) => (await q('SELECT id FROM campuses')).rows.map((r) => r.id));
    expect(seen).toEqual([w1.campusId]);
    expect(await as(u1, async (q) => (await q('SELECT 1 FROM cohorts WHERE campus_id = $1', [w2.campusId])).rowCount)).toBe(0);
    expect(await as(u2, async (q) => (await q('SELECT 1 FROM cohort_members WHERE user_id = $1', [u1])).rowCount)).toBe(0);
  });

  it('the join code hash is not readable even by a member of the campus', async () => {
    const w = await mkCampus();
    const u = await mkMember(w);
    expect(await code(u, 'SELECT code_hmac FROM campuses')).toBe('42501');
    expect(await code(u, 'SELECT * FROM campuses')).toBe('42501');
    expect(await code(u, 'SELECT id, name, cgpa_rule FROM campuses')).toBeUndefined();
  });

  it('constraints: verified_via and verified_at must agree; one seat per user and per mailbox', async () => {
    const w = await mkCampus();
    const a = await mkUser(c);
    const b = await mkUser(c);
    const bad = (sql: string, p: unknown[]) => c.query(sql, p).then(() => undefined, (e: { code?: string }) => e.code);
    expect(await bad("INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at) VALUES ($1, $2, $3, 'code', now())", [a.id, w.campusId, w.cohortId])).toBe('23514');
    expect(await bad("INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via) VALUES ($1, $2, $3, 'email')", [a.id, w.campusId, w.cohortId])).toBe('23514');
    await c.query("INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac) VALUES ($1, $2, $3, 'email', now(), 'dup-mail')", [a.id, w.campusId, w.cohortId]);
    expect(await bad("INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac) VALUES ($1, $2, $3, 'email', now(), 'other')", [a.id, w.campusId, w.cohortId])).toBe('23505');
    expect(await bad("INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac) VALUES ($1, $2, $3, 'email', now(), 'dup-mail')", [b.id, w.campusId, w.cohortId])).toBe('23505');
  });
});

describe('join by code', () => {
  it('lists cohorts for a valid code, joins unverified, and counts nothing toward k', async () => {
    const w = await mkCampus();
    const u = (await mkUser(c)).id;
    const look = await fn(u, 'campus_join_code', w.codeHmac, null, null, null);
    expect(look.status).toBe('choose_cohort');
    expect(look.campus.name).toMatch(/Test College/);
    expect(look.cohorts).toEqual([{ id: w.cohortId, passoutYear: 2026, programme: 'B.Tech CSE' }]);
    const joined = await fn(u, 'campus_join_code', w.codeHmac, w.cohortId, null, null);
    expect(joined).toEqual({ status: 'joined', verifiedVia: 'code' });
    const m = (await c.query('SELECT verified_at, verified_via FROM cohort_members WHERE user_id = $1', [u])).rows[0];
    expect(m).toEqual({ verified_at: null, verified_via: 'code' });
    expect((await fn(u, 'campus_join_code', w.codeHmac, w.cohortId, null, null)).status).toBe('already_member');
  });

  it('answers one way for a wrong code and records the attempt', async () => {
    const w = await mkCampus();
    const u = (await mkUser(c)).id;
    expect((await fn(u, 'campus_join_code', 'nope', null, null, null)).status).toBe('invalid_code');
    expect((await fn(u, 'campus_join_code', 'nope2', w.cohortId, null, null)).status).toBe('invalid_code');
    const n = (await c.query("SELECT count(*)::int AS n FROM join_attempts WHERE user_id = $1 AND kind = 'code' AND NOT ok", [u])).rows[0].n;
    expect(n).toBe(2);
  });

  it('refuses a cohort from another campus', async () => {
    const w1 = await mkCampus();
    const w2 = await mkCampus();
    const u = (await mkUser(c)).id;
    expect((await fn(u, 'campus_join_code', w1.codeHmac, w2.cohortId, null, null)).status).toBe('invalid_cohort');
    expect((await c.query('SELECT 1 FROM cohort_members WHERE user_id = $1', [u])).rowCount).toBe(0);
  });

  it('rate limits per user (10 per 15 minutes) even for the right code, and per IP', async () => {
    const w = await mkCampus();
    const u = (await mkUser(c)).id;
    for (let i = 0; i < 10; i++) expect((await fn(u, 'campus_join_code', `wrong-${i}`, null, null, null)).status).toBe('invalid_code');
    expect((await fn(u, 'campus_join_code', w.codeHmac, w.cohortId, null, null)).status).toBe('rate_limited');
    expect((await c.query('SELECT 1 FROM cohort_members WHERE user_id = $1', [u])).rowCount).toBe(0);

    const ip = `ip-${randomUUID()}`;
    await c.query("INSERT INTO join_attempts (user_id, kind, ip_hash, ok) SELECT $1, 'code', $2, false FROM generate_series(1, 60)", [(await mkUser(c)).id, ip]);
    const fresh = (await mkUser(c)).id;
    expect((await fn(fresh, 'campus_join_code', w.codeHmac, w.cohortId, null, ip)).status).toBe('rate_limited');
    expect((await fn(fresh, 'campus_join_code', w.codeHmac, w.cohortId, null, null)).status).toBe('joined');
  });

  it('a proven account mailbox on the roster verifies at join, an unproven one does not, and a taken seat is not reused', async () => {
    const w = await mkCampus();
    await c.query("INSERT INTO cohort_roster (campus_id, cohort_id, email_hmac, placed) VALUES ($1, $2, 'roster-mail', true)", [w.campusId, w.cohortId]);
    const u = (await mkUser(c)).id;
    expect(await fn(u, 'campus_join_code', w.codeHmac, w.cohortId, 'roster-mail', null)).toEqual({ status: 'joined', verifiedVia: 'roster' });
    expect((await c.query('SELECT placed, verified_at IS NOT NULL AS v FROM cohort_members WHERE user_id = $1', [u])).rows[0]).toEqual({ placed: true, v: true });
    // Someone else claiming the same mailbox hash joins unverified.
    const v = (await mkUser(c)).id;
    expect(await fn(v, 'campus_join_code', w.codeHmac, w.cohortId, 'roster-mail', null)).toEqual({ status: 'joined', verifiedVia: 'code' });
    // An account whose email is not verified cannot use the mailbox to verify.
    const unverified = (await mkUser(c)).id;
    await c.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [unverified]);
    await c.query("INSERT INTO cohort_roster (campus_id, cohort_id, email_hmac) VALUES ($1, $2, 'roster-mail-2')", [w.campusId, w.cohortId]);
    expect(await fn(unverified, 'campus_join_code', w.codeHmac, w.cohortId, 'roster-mail-2', null)).toEqual({ status: 'joined', verifiedVia: 'code' });
  });
});

/** Moves every cooldown window past: this user's attempts and every open challenge are two minutes older. */
const cool = async (u: string): Promise<void> => {
  await c.query("UPDATE join_attempts SET at = at - interval '2 minutes' WHERE user_id = $1", [u]);
  await c.query("UPDATE otp_challenges SET created_at = created_at - interval '2 minutes' WHERE created_at > now() - interval '2 minutes'");
};

describe('join by college email (OTP purpose campus_email)', () => {
  const issue = (u: string, w: World, mail: string, challenge = randomUUID(), hash = 'hash-1') => fn(u, 'campus_email_issue', mail, w.domain, challenge, hash, null).then((r) => ({ r, challenge }));

  it('issue, spend, join: verified, and the code works once', async () => {
    const w = await mkCampus();
    const u = (await mkUser(c)).id;
    const { r, challenge } = await issue(u, w, 'mbx-1');
    expect(r).toEqual({ status: 'sent' });
    const spent = await fn(u, 'campus_email_spend', 'mbx-1', null);
    expect(spent).toMatchObject({ status: 'spent', challengeId: challenge, codeHash: 'hash-1' });
    expect(await fn(u, 'campus_email_join', challenge, 'hash-1', 'mbx-1', w.cohortId)).toEqual({ status: 'joined', verifiedVia: 'email' });
    const m = (await c.query('SELECT verified_via, verified_at IS NOT NULL AS v, email_hmac FROM cohort_members WHERE user_id = $1', [u])).rows[0];
    expect(m).toEqual({ verified_via: 'email', v: true, email_hmac: 'mbx-1' });
    expect((await fn(u, 'campus_email_join', challenge, 'hash-1', 'mbx-1', w.cohortId)).status).toBe('invalid');
  });

  it('a domain nobody registered is refused, and the campus comes from the binding', async () => {
    const w1 = await mkCampus();
    const w2 = await mkCampus();
    const u = (await mkUser(c)).id;
    expect((await fn(u, 'campus_email_issue', 'mbx-x', 'gmail.com', randomUUID(), 'h', null)).status).toBe('unknown_domain');
    await cool(u);
    const { challenge } = await issue(u, w1, 'mbx-2');
    await fn(u, 'campus_email_spend', 'mbx-2', null);
    // A cohort from another campus is refused and does not burn the code.
    expect((await fn(u, 'campus_email_join', challenge, 'hash-1', 'mbx-2', w2.cohortId)).status).toBe('invalid_cohort');
    expect((await fn(u, 'campus_email_join', challenge, 'hash-1', 'mbx-2', w1.cohortId)).status).toBe('joined');
  });

  it('a wrong hash is invalid; five attempts are the limit even for the right code; only the newest challenge works', async () => {
    const w = await mkCampus();
    const u = (await mkUser(c)).id;
    const { challenge } = await issue(u, w, 'mbx-3');
    await cool(u);
    for (let i = 0; i < 5; i++) {
      const s = await fn(u, 'campus_email_spend', 'mbx-3', null);
      expect(s.status).toBe('spent');
      expect((await fn(u, 'campus_email_join', challenge, `wrong-${i}`, 'mbx-3', w.cohortId)).status).toBe('invalid');
    }
    expect((await fn(u, 'campus_email_spend', 'mbx-3', null)).status).toBe('none');

    const second = await issue(u, w, 'mbx-4', randomUUID(), 'h-old');
    await cool(u);
    const newer = await issue(u, w, 'mbx-4', randomUUID(), 'h-new');
    expect(second.challenge).not.toBe(newer.challenge);
    expect((await fn(u, 'campus_email_join', second.challenge, 'h-old', 'mbx-4', w.cohortId)).status).toBe('invalid');
    expect(await fn(u, 'campus_email_spend', 'mbx-4', null)).toMatchObject({ status: 'spent', codeHash: 'h-new' });
  });

  it('an expired challenge and another user\'s challenge are both invalid', async () => {
    const w = await mkCampus();
    const u = (await mkUser(c)).id;
    const other = (await mkUser(c)).id;
    const { challenge } = await issue(u, w, 'mbx-5');
    expect((await fn(other, 'campus_email_join', challenge, 'hash-1', 'mbx-5', w.cohortId)).status).toBe('invalid');
    expect((await fn(other, 'campus_email_spend', 'mbx-5', null)).status).toBe('none');
    await c.query("UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE id = $1", [challenge]);
    expect((await fn(u, 'campus_email_spend', 'mbx-5', null)).status).toBe('none');
    expect((await fn(u, 'campus_email_join', challenge, 'hash-1', 'mbx-5', w.cohortId)).status).toBe('invalid');
  });

  it('one mailbox gets one seat, and a taken seat does not burn the code', async () => {
    const w = await mkCampus();
    const first = (await mkUser(c)).id;
    const second = (await mkUser(c)).id;
    const a = await issue(first, w, 'shared-box');
    await fn(first, 'campus_email_spend', 'shared-box', null);
    expect((await fn(first, 'campus_email_join', a.challenge, 'hash-1', 'shared-box', w.cohortId)).status).toBe('joined');
    await cool(first);
    const b = await issue(second, w, 'shared-box');
    await fn(second, 'campus_email_spend', 'shared-box', null);
    expect((await fn(second, 'campus_email_join', b.challenge, 'hash-1', 'shared-box', w.cohortId)).status).toBe('seat_taken');
    expect((await c.query('SELECT consumed_at FROM otp_challenges WHERE id = $1', [b.challenge])).rows[0].consumed_at).toBeNull();
  });

  it('send is rate limited: a 60 second cooldown, then five per 15 minutes', async () => {
    const w = await mkCampus();
    const u = (await mkUser(c)).id;
    expect((await issue(u, w, 'mbx-6')).r.status).toBe('sent');
    expect((await issue(u, w, 'mbx-6')).r.status).toBe('cooldown');
    for (let i = 0; i < 4; i++) {
      await cool(u);
      await issue(u, w, 'mbx-6');
    }
    await cool(u);
    expect((await issue(u, w, 'mbx-6')).r.status).toBe('rate_limited');
  });

  it('a roster row for the mailbox verifies the member as placed', async () => {
    const w = await mkCampus();
    await c.query("INSERT INTO cohort_roster (campus_id, cohort_id, email_hmac, placed) VALUES ($1, $2, 'mbx-7', true)", [w.campusId, w.cohortId]);
    const u = (await mkUser(c)).id;
    const { challenge } = await issue(u, w, 'mbx-7');
    await fn(u, 'campus_email_spend', 'mbx-7', null);
    await fn(u, 'campus_email_join', challenge, 'hash-1', 'mbx-7', w.cohortId);
    expect((await c.query('SELECT placed FROM cohort_members WHERE user_id = $1', [u])).rows[0].placed).toBe(true);
  });

  it('per mailbox, from any account: a 60 second cooldown; ten a day per (mailbox, account), forty per mailbox', async () => {
    const w = await mkCampus();
    const [a, b, d] = [(await mkUser(c)).id, (await mkUser(c)).id, (await mkUser(c)).id];
    expect((await issue(a, w, 'victim-box')).r.status).toBe('sent');
    // Other accounts aiming at the same mailbox are held by the mailbox's own cooldown, not only their own.
    expect((await issue(b, w, 'victim-box')).r.status).toBe('cooldown');
    expect((await issue(d, w, 'victim-box')).r.status).toBe('cooldown');
    expect((await c.query("SELECT count(*)::int AS n FROM otp_challenges WHERE target_hmac = 'victim-box'")).rows[0].n).toBe(1);
    // A stranger who has used up ten sends of their own is held back, but cannot use up the victim's allowance.
    await c.query(
      "INSERT INTO otp_challenges (channel, purpose, target_hmac, code_hash, expires_at, created_at, consumed_at, user_id) SELECT 'email', 'campus_email', 'victim-box', 'x', now(), now() - interval '5 hours', now(), $1 FROM generate_series(1, 10)",
      [b],
    );
    await cool(b);
    expect((await issue(b, w, 'victim-box')).r.status).toBe('rate_limited');
    await cool(a);
    await c.query("UPDATE otp_challenges SET created_at = created_at - interval '2 minutes' WHERE target_hmac = 'victim-box' AND user_id = $1", [a]);
    expect((await issue(a, w, 'victim-box')).r.status).toBe('sent');
    // The mailbox itself is still protected from a flood spread over many accounts: forty a day.
    await c.query(
      "INSERT INTO otp_challenges (channel, purpose, target_hmac, code_hash, expires_at, created_at, consumed_at) SELECT 'email', 'campus_email', 'bombed-box', 'x', now(), now() - interval '5 hours', now() FROM generate_series(1, 40)",
    );
    await cool(d);
    expect((await issue(d, w, 'bombed-box')).r.status).toBe('rate_limited');
    // A different mailbox is unaffected.
    await cool(b);
    expect((await issue(b, w, 'someone-else-box')).r.status).toBe('sent');
  });

  it('verification attempts: ten an hour per (mailbox, account); one account cannot use up another account\'s budget', async () => {
    const w = await mkCampus();
    const users = [(await mkUser(c)).id, (await mkUser(c)).id, (await mkUser(c)).id];
    for (const u of users) {
      await issue(u, w, 'victim-box-2', randomUUID(), `h-${u}`);
      await cool(u);
    }
    // Each account may spend five tries on its own code (the per-code limit); the three accounts do not share a budget.
    let spent = 0;
    for (let round = 0; round < 5; round++) for (const u of users) if ((await fn(u, 'campus_email_spend', 'victim-box-2', null)).status === 'spent') spent++;
    expect(spent).toBe(15);
    // An account that burned ten tries on earlier codes this hour is held back; the others are not.
    const burner = (await mkUser(c)).id;
    await c.query(
      "INSERT INTO otp_challenges (channel, purpose, target_hmac, code_hash, expires_at, attempts, created_at, consumed_at, user_id) VALUES ('email', 'campus_email', 'victim-box-2', 'x', now(), 5, now(), now(), $1), ('email', 'campus_email', 'victim-box-2', 'x', now(), 5, now(), now(), $1)",
      [burner],
    );
    expect((await fn(burner, 'campus_email_spend', 'victim-box-2', null)).status).toBe('rate_limited');
    const victim = (await mkUser(c)).id;
    expect((await fn(victim, 'campus_email_spend', 'victim-box-2', null)).status).toBe('none');
    await c.query("UPDATE otp_challenges SET created_at = created_at - interval '2 hours' WHERE target_hmac = 'victim-box-2'");
    expect((await fn(burner, 'campus_email_spend', 'victim-box-2', null)).status).toBe('none');
  });

  it("one account asking for a code does not cancel another account's open code for the same mailbox", async () => {
    const w = await mkCampus();
    const real = (await mkUser(c)).id;
    const stranger = (await mkUser(c)).id;
    const mine = await issue(real, w, 'shared-target', randomUUID(), 'real-hash');
    await cool(real);
    await cool(stranger);
    await issue(stranger, w, 'shared-target', randomUUID(), 'stranger-hash');
    expect((await c.query('SELECT consumed_at FROM otp_challenges WHERE id = $1', [mine.challenge])).rows[0].consumed_at).toBeNull();
    expect(await fn(real, 'campus_email_spend', 'shared-target', null)).toMatchObject({ status: 'spent', codeHash: 'real-hash' });
  });

  it('the app role cannot touch the OTP tables directly', async () => {
    const u = (await mkUser(c)).id;
    expect(await code(u, 'SELECT 1 FROM otp_challenges')).toBe('42501');
    expect(await code(u, 'SELECT 1 FROM campus_otp_bindings')).toBe('42501');
  });
});

describe('TPO functions: staff only, over snapshots and shared rows', () => {
  const snapshot = async (cohortId: string, day: string, rows: Record<string, [number, number]>) => {
    for (const [metric, [n, p]] of Object.entries(rows)) {
      await c.query('INSERT INTO cohort_stats_daily (cohort_id, day, metric, n, p) VALUES ($1, $2, $3, $4, $5)', [cohortId, day, metric, n, p]);
    }
  };

  it('a non-staff caller and a staff member of another campus get NULL from every TPO function', async () => {
    const w = await mkCampus();
    const other = await mkCampus();
    const student = await mkMember(w);
    const strangerStaff = await mkStaff(other);
    for (const who of [student, strangerStaff]) {
      expect(await fn(who, 'tpo_list_cohorts', w.campusId)).toBeNull();
      expect(await fn(who, 'tpo_cohort_stats', w.cohortId)).toBeNull();
      expect(await fn(who, 'tpo_create_cohort', w.campusId, 2027, 'MBA')).toBeNull();
      expect(await fn(who, 'tpo_list_drives', w.campusId)).toBeNull();
      expect(await fn(who, 'tpo_publish_drive', w.cohortId, 't', null, 'n', '[]', '[]', 'none')).toBeNull();
      expect(await fn(who, 'tpo_list_outcomes', w.campusId, null)).toBeNull();
      expect(await fn(who, 'tpo_naac_rows', w.campusId, null)).toBeNull();
      expect(await fn(who, 'tpo_import_roster', w.cohortId, '[]', 0, 0)).toBeNull();
      expect(await fn(who, 'tpo_invite_staff', w.campusId, 'x')).toBeNull();
      expect(await fn(who, 'tpo_list_staff', w.campusId)).toBeNull();
    }
  });

  it('with no user context the functions error instead of answering', async () => {
    await c.query('BEGIN');
    try {
      await c.query('SET LOCAL ROLE hirelane_app');
      await expect(c.query('SELECT tpo_memberships()')).rejects.toThrow();
    } finally {
      await c.query('ROLLBACK');
    }
  });

  it('stats come from the latest snapshot only, suppressed and rounded; the app role cannot read the snapshot table', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    await snapshot(w.cohortId, '2026-10-01', { joined_verified: [30, 30], stage_confirmed: [30, 30] });
    await snapshot(w.cohortId, '2026-10-02', {
      joined_verified: [43, 43],
      stage_no_resume: [4, 43],
      stage_resume_unconfirmed: [14, 43],
      stage_confirmed: [25, 43],
      ats_readable: [18, 39],
      blocker_active_backlog: [9, 25],
      interview_reported: [12, 43],
      'drive_eligible:00000000-0000-4000-8000-000000000000': [20, 43],
    });
    const stats = await fn(staff, 'tpo_cohort_stats', w.cohortId);
    expect(stats.day).toBe('2026-10-02');
    const by = Object.fromEntries(stats.metrics.map((m: any) => [m.metric, m]));
    expect(by.joined_verified).toMatchObject({ value: 45, suppressed: false });
    // stage_no_resume (4) is under k; complementary suppression also hides the smallest other cell.
    expect(by.stage_no_resume.suppressed).toBe(true);
    expect(by.stage_resume_unconfirmed.suppressed).toBe(true);
    expect(by.stage_confirmed).toMatchObject({ value: 25, suppressed: false });
    expect(by.ats_readable).toMatchObject({ value: 20, suppressed: false });
    expect(by.blocker_active_backlog.suppressed).toBe(true);
    expect(by.interview_reported).toMatchObject({ value: 10, suppressed: false });
    expect(Object.keys(by)).not.toContain('drive_eligible');
    expect(await code(staff, 'SELECT * FROM cohort_stats_daily')).toBe('42501');
    const none = await fn(staff, 'tpo_cohort_stats', (await mkCampus().then(async (x) => { await c.query("INSERT INTO tpo_members (campus_id, user_id, email_hmac, role, claimed_at) VALUES ($1, $2, 'dup', 'staff', now())", [x.campusId, staff]); return x; })).cohortId);
    expect(none).toEqual({ day: null, metrics: [] });
  });

  it('a cohort under k shows no joined count; cohorts list rounds the count', async () => {
    const w = await mkCampus();
    const second = randomUUID();
    await c.query("INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2026, 'MBA')", [second, w.campusId]);
    const staff = await mkStaff(w);
    await snapshot(w.cohortId, '2026-10-02', { joined_verified: [43, 43] });
    await snapshot(second, '2026-10-02', { joined_verified: [7, 7] });
    await c.query("INSERT INTO cohort_roster (campus_id, cohort_id, email_hmac) VALUES ($1, $2, 'r1'), ($1, $2, 'r2')", [w.campusId, w.cohortId]);
    const list = await fn(staff, 'tpo_list_cohorts', w.campusId);
    const a = list.find((x: any) => x.id === w.cohortId);
    const b = list.find((x: any) => x.id === second);
    expect(a).toMatchObject({ joined: 45, joinedSuppressed: false, rosterSize: 2, snapshotDay: '2026-10-02' });
    expect(b).toMatchObject({ joined: null, joinedSuppressed: true });
  });

  it('drive counts are suppressed as a group; a drive from another campus is NULL', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const published = await fn(staff, 'tpo_publish_drive', w.cohortId, 'Drive A', null, 'Open to all branches.', '[]', '[]', 'none');
    expect(published).toMatch(/^[0-9a-f-]{36}$/);
    await snapshot(w.cohortId, '2026-10-02', {
      [`drive_eligible:${published}`]: [31, 50],
      [`drive_unknown:${published}`]: [16, 50],
      [`drive_ineligible:${published}`]: [3, 50],
    });
    const counts = await fn(staff, 'tpo_drive_counts', published);
    const by = Object.fromEntries(counts.metrics.map((m: any) => [m.metric, m]));
    expect(by.drive_ineligible.suppressed).toBe(true);
    expect(by.drive_unknown.suppressed).toBe(true); // complementary
    expect(by.drive_eligible).toMatchObject({ value: 30, suppressed: false });
    const outsider = await mkStaff(await mkCampus());
    expect(await fn(outsider, 'tpo_drive_counts', published)).toBeNull();
  });

  it('students read published drives of their own cohort only', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w);
    const student = await mkMember(w);
    const otherCohort = randomUUID();
    await c.query("INSERT INTO cohorts (id, campus_id, passout_year, programme) VALUES ($1, $2, 2027, 'MBA')", [otherCohort, w.campusId]);
    const d1 = await fn(staff, 'tpo_publish_drive', w.cohortId, 'Mine', 'https://example.test/x', 'Open.', '[]', '[]', 'none');
    await fn(staff, 'tpo_publish_drive', otherCohort, 'Not mine', null, 'Open.', '[]', '[]', 'none');
    await c.query("UPDATE drives SET status = 'closed' WHERE title = 'Not mine'");
    const rows = await as(student, async (q) => (await q('SELECT id, title FROM drives')).rows);
    expect(rows).toEqual([{ id: d1, title: 'Mine' }]);
    expect(await code(student, "INSERT INTO drives (campus_id, cohort_id, title, notice_text) VALUES ($1, $2, 't', 'n')", [w.campusId, w.cohortId])).toBe('42501');
  });

  it('roster import stages rows only on registered domains, returns no match count, and changes no member until the snapshot applies it', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const unproven = await mkMember(w, { via: 'code', mail: undefined });
    await c.query("UPDATE cohort_members SET email_hmac = 'known-box' WHERE user_id = $1", [unproven]);
    const rows = [{ h: 'known-box', d: w.domain, placed: true }, ...Array.from({ length: 11 }, (_, i) => ({ h: `box-${i}`, d: w.domain, placed: false })), { h: 'foreign-box', d: 'elsewhere.example.test', placed: true }];
    const res = await fn(staff, 'tpo_import_roster', w.cohortId, JSON.stringify(rows), 15, 3);
    expect(res).toEqual({ status: 'imported', rowsTotal: 15, rowsValid: 12, rowsRejected: 4 });
    expect(JSON.stringify(res)).not.toContain('matched');
    // The foreign-domain row was refused, the rest staged; the member is untouched.
    expect((await c.query("SELECT count(*)::int AS n FROM cohort_roster WHERE cohort_id = $1 AND email_hmac = 'foreign-box'", [w.cohortId])).rows[0].n).toBe(0);
    expect((await c.query('SELECT count(*)::int AS n FROM cohort_roster WHERE cohort_id = $1', [w.cohortId])).rows[0].n).toBe(12);
    expect((await c.query('SELECT verified_via, verified_at IS NOT NULL AS v, placed FROM cohort_members WHERE user_id = $1', [unproven])).rows[0]).toEqual({ verified_via: 'code', v: false, placed: false });
    expect((await c.query('SELECT matched FROM cohort_imports WHERE cohort_id = $1', [w.cohortId])).rows[0].matched).toBe(0);
    // The app role cannot apply it; the snapshot job (owner) does, and reports who changed.
    expect(await code(staff, 'SELECT campus_apply_roster()')).toBe('42501');
    const changed = (await c.query('SELECT campus_apply_roster() AS r')).rows[0].r;
    expect(changed).toContain(unproven);
    expect((await c.query('SELECT verified_via, verified_at IS NOT NULL AS v, placed, placed_changed_at IS NOT NULL AS ch FROM cohort_members WHERE user_id = $1', [unproven])).rows[0]).toEqual({ verified_via: 'roster', v: true, placed: true, ch: true });
  });

  it('roster import refuses fewer than ten valid rows, and a second import inside 24 hours', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const few = Array.from({ length: 9 }, (_, i) => ({ h: `few-${i}`, d: w.domain, placed: false }));
    expect(await fn(staff, 'tpo_import_roster', w.cohortId, JSON.stringify(few), 9, 0)).toEqual({ status: 'too_few' });
    expect((await c.query('SELECT count(*)::int AS n FROM cohort_roster WHERE cohort_id = $1', [w.cohortId])).rows[0].n).toBe(0);
    // Ten rows on the registered domain are fine, but ten rows of which most are off-domain are not.
    const mixed = [...few.slice(0, 5), ...Array.from({ length: 20 }, (_, i) => ({ h: `off-${i}`, d: 'other.example.test', placed: false }))];
    expect(await fn(staff, 'tpo_import_roster', w.cohortId, JSON.stringify(mixed), 25, 0)).toEqual({ status: 'too_few' });
    const ten = Array.from({ length: 10 }, (_, i) => ({ h: `ten-${i}`, d: w.domain.toUpperCase(), placed: false }));
    expect((await fn(staff, 'tpo_import_roster', w.cohortId, JSON.stringify(ten), 10, 0)).status).toBe('imported');
    expect(await fn(staff, 'tpo_import_roster', w.cohortId, JSON.stringify(ten), 10, 0)).toEqual({ status: 'rate_limited' });
  });

  it('a one-row re-import cannot be used to probe one student: nothing about membership comes back', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const member = await mkMember(w, { via: 'email', share: 'aggregate' });
    await c.query("UPDATE cohort_members SET email_hmac = 'probe-box' WHERE user_id = $1", [member]);
    const probe = await fn(staff, 'tpo_import_roster', w.cohortId, JSON.stringify([{ h: 'probe-box', d: w.domain, placed: false }]), 1, 0);
    expect(probe).toEqual({ status: 'too_few' });
  });

  it('staff lifecycle: invites expire, the owner removes staff and transfers ownership, the last owner stays, every change is logged', async () => {
    const w = await mkCampus();
    const owner = await mkStaff(w, 'owner');
    const staff = await mkStaff(w, 'staff');
    expect(await fn(staff, 'tpo_remove_staff', w.campusId, randomUUID())).toBeNull();
    const list = await fn(owner, 'tpo_list_staff', w.campusId);
    const staffRow = list.find((s: any) => s.role === 'staff');
    const ownerRow = list.find((s: any) => s.role === 'owner');
    expect(await fn(staff, 'tpo_remove_staff', w.campusId, staffRow.id)).toBeNull();
    expect(await fn(owner, 'tpo_remove_staff', w.campusId, ownerRow.id)).toEqual({ status: 'last_owner' });
    expect(await fn(owner, 'tpo_remove_staff', w.campusId, staffRow.id)).toEqual({ status: 'removed' });
    // Removed staff are no longer staff.
    expect(await fn(staff, 'tpo_list_cohorts', w.campusId)).toBeNull();
    expect((await c.query("SELECT count(*)::int AS n FROM tpo_access_log WHERE campus_id = $1 AND action = 'staff_removed'", [w.campusId])).rows[0].n).toBe(1);
    // An invite that was never claimed expires and cannot be claimed late; the owner can re-issue it.
    expect(await fn(owner, 'tpo_invite_staff', w.campusId, 'late-box')).toEqual({ status: 'invited' });
    await c.query("UPDATE tpo_members SET expires_at = now() - interval '1 minute' WHERE email_hmac = 'late-box'");
    const late = (await mkUser(c)).id;
    expect(await fn(late, 'tpo_claim_invites', 'late-box')).toBe(0);
    expect(await fn(owner, 'tpo_invite_staff', w.campusId, 'late-box')).toEqual({ status: 'invited' });
    expect(await fn(late, 'tpo_claim_invites', 'late-box')).toBe(1);
    // Ownership moves to a claimed staff member; the old owner becomes staff.
    const lateRow = (await fn(owner, 'tpo_list_staff', w.campusId)).find((s: any) => s.role === 'staff');
    expect(await fn(owner, 'tpo_transfer_ownership', w.campusId, lateRow.id)).toEqual({ status: 'transferred' });
    expect(await fn(owner, 'tpo_list_staff', w.campusId)).toBeNull();
    expect(Array.isArray(await fn(late, 'tpo_list_staff', w.campusId))).toBe(true);
  });

  it('a campus_share consent is written in the join transaction (code and email), default level aggregate', async () => {
    const w = await mkCampus();
    const u = (await mkUser(c)).id;
    expect((await fn(u, 'campus_join_code', w.codeHmac, w.cohortId, null, null)).status).toBe('joined');
    const k = (await c.query("SELECT granted, doc_version FROM consents WHERE user_id = $1 AND kind = 'campus_share'", [u])).rows;
    expect(k).toEqual([{ granted: false, doc_version: 'share-v1:aggregate' }]);
    const v = (await mkUser(c)).id;
    const challenge = randomUUID();
    await fn(v, 'campus_email_issue', 'consent-box', w.domain, challenge, 'hash-1', null);
    await fn(v, 'campus_email_spend', 'consent-box', null);
    expect((await fn(v, 'campus_email_join', challenge, 'hash-1', 'consent-box', w.cohortId)).status).toBe('joined');
    expect((await c.query("SELECT doc_version FROM consents WHERE user_id = $1 AND kind = 'campus_share'", [v])).rows).toEqual([{ doc_version: 'share-v1:aggregate' }]);
  });

  it('the global join breaker holds back only callers who have failed recently', async () => {
    const w = await mkCampus();
    const honest = (await mkUser(c)).id;
    const attacker = (await mkUser(c)).id;
    await c.query("INSERT INTO join_attempts (user_id, kind, ok) SELECT $1, 'code', false FROM generate_series(1, 320)", [attacker]);
    expect((await fn(attacker, 'campus_join_code', 'nope', null, null, null)).status).toBe('rate_limited');
    expect((await fn(honest, 'campus_join_code', w.codeHmac, w.cohortId, null, null)).status).toBe('joined');
  });

  it('a campus CGPA rule must have a sensible multiplier and offset', async () => {
    const w = await mkCampus();
    const set = (rule: unknown) => c.query('UPDATE campuses SET cgpa_rule = $2::jsonb WHERE id = $1', [w.campusId, JSON.stringify(rule)]).then(() => undefined, (e: { code?: string; constraint?: string }) => e.constraint);
    expect(await set({ kind: 'linear', a: 10, b: -7.5 })).toBeUndefined();
    expect(await set({ kind: 'linear', a: 9.5, b: 0 })).toBeUndefined();
    for (const bad of [{ kind: 'linear', a: 0, b: 0 }, { kind: 'linear', a: -10, b: 0 }, { kind: 'linear', a: 10, b: 500 }, { kind: 'linear', a: 25, b: 0 }, { kind: 'linear', a: 10, b: -60 }]) {
      expect(await set(bad), JSON.stringify(bad)).toBe('campuses_cgpa_rule_bounds');
    }
  });

  it('at most ten drives per cohort per 30 days', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    for (let i = 0; i < 10; i++) expect(await fn(staff, 'tpo_publish_drive', w.cohortId, `d${i}`, null, 'n', '[]', '[]', 'none')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await code(staff, "SELECT tpo_publish_drive($1, 'd11', null, 'n', '[]', '[]', 'none')", [w.cohortId])).toBe('23514');
  });

  it('staff invites: owner only; the invite is claimed once by the verified mailbox', async () => {
    const w = await mkCampus();
    const owner = await mkStaff(w, 'owner');
    const staff = await mkStaff(w, 'staff');
    expect(await fn(staff, 'tpo_invite_staff', w.campusId, 'new-box')).toBeNull();
    expect(await fn(owner, 'tpo_invite_staff', w.campusId, 'new-box')).toEqual({ status: 'invited' });
    expect(await fn(owner, 'tpo_invite_staff', w.campusId, 'new-box')).toEqual({ status: 'exists' });
    const list = await fn(owner, 'tpo_list_staff', w.campusId);
    expect(list.filter((s: any) => !s.claimed)).toHaveLength(1);
    expect(list.every((s: any) => !('email' in s) && !('emailHmac' in s))).toBe(true);

    const invitee = (await mkUser(c)).id;
    expect(await fn(invitee, 'tpo_claim_invites', 'someone-else')).toBe(0);
    expect(await fn(invitee, 'tpo_claim_invites', 'new-box')).toBe(1);
    expect(await fn(invitee, 'tpo_claim_invites', 'new-box')).toBe(0);
    expect(await fn(invitee, 'tpo_memberships')).toEqual([{ campusId: w.campusId, campusName: expect.any(String), role: 'staff' }]);
    // An account whose email is not verified cannot claim.
    const raw = (await mkUser(c)).id;
    await c.query('UPDATE users SET email_verified_at = NULL WHERE id = $1', [raw]);
    await fn(owner, 'tpo_invite_staff', w.campusId, 'second-box');
    expect(await fn(raw, 'tpo_claim_invites', 'second-box')).toBe(0);
  });

  it('cohort creation is idempotent per year and programme (case-insensitive)', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const made = await fn(staff, 'tpo_create_cohort', w.campusId, 2027, 'BCA');
    expect(made.created).toBe(true);
    expect(await fn(staff, 'tpo_create_cohort', w.campusId, 2027, 'bca')).toEqual({ id: made.id, created: false });
  });
});

describe('outcomes: student reports, TPO verifies, share levels and consent gate the TPO view', () => {
  const report = (u: string, w: World, kind = 'offer', employer = 'Acme Works', pkg: number | null = 4.5) =>
    call(u, `INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer, package_lpa) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [u, w.campusId, w.cohortId, kind, employer, pkg]).then((r) => r.id as string);

  it('a student reports in their own campus and cohort only, edits until verified, and cannot set verification', async () => {
    const w = await mkCampus();
    const w2 = await mkCampus();
    const u = await mkMember(w);
    const id = await report(u, w);
    expect(await code(u, `INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer) VALUES ($1, $2, $3, 'offer', 'X')`, [u, w2.campusId, w2.cohortId])).toBe('42501');
    expect(await code(u, `INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer, verification) VALUES ($1, $2, $3, 'offer', 'X', 'tpo_verified')`, [u, w.campusId, w.cohortId])).toBe('42501');
    expect(await code(u, "UPDATE outcomes SET verification = 'tpo_verified' WHERE id = $1", [id])).toBe('42501');
    expect(await code(u, "UPDATE outcomes SET employer = 'Acme Works Pvt Ltd' WHERE id = $1", [id])).toBeUndefined();
    expect(await code(u, 'DELETE FROM outcomes WHERE id = $1', [id])).toBe('42501');
    await c.query("UPDATE outcomes SET verification = 'tpo_verified', verified_at = now() WHERE id = $1", [id]);
    expect(await as(u, async (q) => (await q("UPDATE outcomes SET employer = 'Edited' WHERE id = $1", [id])).rowCount)).toBe(0);
  });

  it('the TPO list shows only students at outcomes or full, names them, shows email only at full, and logs each student', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const agg = await mkMember(w, { share: 'aggregate' });
    const out = await mkMember(w, { share: 'outcomes' });
    const full = await mkMember(w, { share: 'full' });
    for (const u of [agg, out, full]) await report(u, w, 'interview', `Co-${u.slice(0, 4)}`);
    await c.query("UPDATE users SET display_name = 'Asha Test' WHERE id = $1", [out]);
    const rows = await fn(staff, 'tpo_list_outcomes', w.campusId, null);
    expect(rows).toHaveLength(2);
    const byName = Object.fromEntries(rows.map((r: any) => [r.employer, r]));
    expect(byName[`Co-${out.slice(0, 4)}`]).toMatchObject({ studentName: 'Asha Test', studentEmail: null, verification: 'student_reported', memberVerified: true });
    expect(byName[`Co-${full.slice(0, 4)}`].studentEmail).toMatch(/@example\.test$/);
    expect(JSON.stringify(rows)).not.toContain(agg);
    // The students see the TPO reads of themselves; the aggregate-only student has none.
    const seenByOut = await as(out, async (q) => (await q('SELECT action, campus_id FROM tpo_access_log')).rows);
    expect(seenByOut).toEqual([{ action: 'outcomes_list', campus_id: w.campusId }]);
    expect(await as(agg, async (q) => (await q('SELECT 1 FROM tpo_access_log')).rowCount)).toBe(0);
    expect(await code(out, 'SELECT actor_id FROM tpo_access_log')).toBe('42501');
    expect(await code(out, 'DELETE FROM tpo_access_log')).toBe('42501');
  });

  it('verify: staff of the campus, student at outcomes or full, logged; otherwise NULL', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const outsider = await mkStaff(await mkCampus());
    const shared = await mkMember(w, { share: 'outcomes' });
    const hidden = await mkMember(w, { share: 'aggregate' });
    const a = await report(shared, w);
    const b = await report(hidden, w);
    expect(await fn(outsider, 'tpo_verify_outcome', a)).toBeNull();
    expect(await fn(staff, 'tpo_verify_outcome', b)).toBeNull();
    expect(await fn(staff, 'tpo_verify_outcome', a)).toEqual({ id: a, verification: 'tpo_verified' });
    const row = (await c.query('SELECT verification, verified_by, verified_at IS NOT NULL AS v FROM outcomes WHERE id = $1', [a])).rows[0];
    expect(row).toEqual({ verification: 'tpo_verified', verified_by: staff, v: true });
    expect((await as(shared, async (q) => (await q("SELECT 1 FROM tpo_access_log WHERE action = 'outcome_verify'")).rowCount))).toBe(1);
  });

  it('the letter is visible to the TPO only with share level, the offer_letter_tpo consent, and an audit row', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const u = await mkMember(w, { share: 'outcomes' });
    const id = await report(u, w);
    await as(u, (q) => q("UPDATE outcomes SET letter_enc = '\\x010203', letter_mime = 'application/pdf' WHERE id = $1", [id]));
    expect(await fn(staff, 'tpo_outcome_letter', id)).toBeNull(); // no consent yet
    await as(u, (q) => q("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'offer_letter_tpo', true, 'v1')", [u]));
    const got = await fn(staff, 'tpo_outcome_letter', id);
    expect(got).toMatchObject({ id, userId: u, mime: 'application/pdf', letterB64: 'AQID' });
    expect((await fn(staff, 'tpo_list_outcomes', w.campusId, null))[0].hasLetter).toBe(true);
    await as(u, (q) => q("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'offer_letter_tpo', false, 'v1')", [u]));
    expect(await fn(staff, 'tpo_outcome_letter', id)).toBeNull(); // withdrawn
    expect((await fn(staff, 'tpo_list_outcomes', w.campusId, null))[0].hasLetter).toBe(false);
    expect(await as(u, async (q) => (await q("SELECT 1 FROM tpo_access_log WHERE action = 'letter_view'")).rowCount)).toBe(1);
  });

  it('NAAC rows: offers of verified members at outcomes or full only, logged per student', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const ok = await mkMember(w, { share: 'outcomes' });
    const unverified = await mkMember(w, { share: 'outcomes', via: 'code' });
    const private_ = await mkMember(w, { share: 'aggregate' });
    await c.query("UPDATE users SET display_name = '=HYPERLINK(1)' WHERE id = $1", [ok]);
    await report(ok, w, 'offer', 'Real Employer', 6);
    await report(ok, w, 'interview', 'Only Interview', null);
    await report(unverified, w, 'offer', 'Unverified Member Co', 3);
    await report(private_, w, 'offer', 'Private Co', 3);
    const out = await fn(staff, 'tpo_naac_rows', w.campusId, null);
    const rows = out.placements;
    expect(rows).toHaveLength(1);
    expect(out.higherEd).toEqual([]);
    // Year is the academic year of the cohort's passout (2026 -> 2025-26), never the year the row was created.
    expect(rows[0]).toMatchObject({ year: '2025-26', student: '=HYPERLINK(1)', programme: 'B.Tech CSE', employer: 'Real Employer', packageLpa: 6, verification: 'student_reported' });
    expect(await fn(staff, 'tpo_naac_rows', w.campusId, 2030)).toEqual({ placements: [], higherEd: [] });
    expect(await as(ok, async (q) => (await q("SELECT 1 FROM tpo_access_log WHERE action = 'naac_export'")).rowCount)).toBe(1);
    expect(await as(private_, async (q) => (await q('SELECT 1 FROM tpo_access_log')).rowCount)).toBe(0);
  });
});

describe('higher_studies outcome kind and the NAAC higher-education part', () => {
  const higher = (u: string, w: World, institution: string, programme: string | null) =>
    call(u, `INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer, role_title) VALUES ($1, $2, $3, 'higher_studies', $4, $5) RETURNING id`, [u, w.campusId, w.cohortId, institution, programme]).then((r) => r.id as string);

  it('the database accepts higher_studies and still refuses other kinds and a package on it', async () => {
    const w = await mkCampus();
    const u = await mkMember(w, { share: 'outcomes' });
    expect(await higher(u, w, 'Test Institute of Science', 'M.Tech VLSI')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await code(u, "INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer) VALUES ($1, $2, $3, 'astronaut', 'X')", [u, w.campusId, w.cohortId])).toBe('23514');
    expect(await code(u, "INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer, package_lpa) VALUES ($1, $2, $3, 'higher_studies', 'X', 5)", [u, w.campusId, w.cohortId])).toBe('23514');
  });

  it('tpo_naac_rows returns {placements, higherEd} under the same consent filter, and logs each student once', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const shared = await mkMember(w, { share: 'outcomes' });
    const hiddenHe = await mkMember(w, { share: 'aggregate' });
    const unverified = await mkMember(w, { share: 'outcomes', via: 'code' });
    await c.query("UPDATE users SET display_name = 'Dev Nair' WHERE id = $1", [shared]);
    await higher(shared, w, 'Test Institute of Science', 'M.Tech VLSI');
    await higher(hiddenHe, w, 'Hidden Univ', 'MS');
    await higher(unverified, w, 'Unverified Univ', 'MS');
    const out = await fn(staff, 'tpo_naac_rows', w.campusId, null);
    expect(out.placements).toEqual([]);
    expect(out.higherEd).toHaveLength(1);
    expect(out.higherEd[0]).toMatchObject({ student: 'Dev Nair', programme: 'B.Tech CSE', institution: 'Test Institute of Science', admittedTo: 'M.Tech VLSI', verification: 'student_reported' });
    expect(JSON.stringify(out)).not.toMatch(/Hidden Univ|Unverified Univ/);
    expect(await as(shared, async (q) => (await q("SELECT 1 FROM tpo_access_log WHERE action = 'naac_export'")).rowCount)).toBe(1);
    expect(await as(hiddenHe, async (q) => (await q('SELECT 1 FROM tpo_access_log')).rowCount)).toBe(0);
    expect(await fn(staff, 'tpo_naac_rows', w.campusId, 2030)).toEqual({ placements: [], higherEd: [] });
  });

  it('a student with an offer and a higher-studies record is logged once, not twice, per export', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const u = await mkMember(w, { share: 'full' });
    await call(u, "INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer, package_lpa) VALUES ($1, $2, $3, 'offer', 'Acme', 5)", [u, w.campusId, w.cohortId]);
    await higher(u, w, 'Test Institute of Science', null);
    const out = await fn(staff, 'tpo_naac_rows', w.campusId, null);
    expect(out.placements).toHaveLength(1);
    expect(out.higherEd).toHaveLength(1);
    expect(out.higherEd[0].admittedTo).toBe('');
    expect(await as(u, async (q) => (await q("SELECT 1 FROM tpo_access_log WHERE action = 'naac_export'")).rowCount)).toBe(1);
  });

  it('higher_studies does not count as an offer in the stats or notify on verify', async () => {
    const w = await mkCampus();
    const staff = await mkStaff(w, 'staff');
    const u = await mkMember(w, { share: 'outcomes' });
    const id = await higher(u, w, 'Test Institute of Science', 'MS');
    await fn(staff, 'tpo_verify_outcome', id);
    expect(await as(u, async (q) => (await q("SELECT 1 FROM notifications WHERE kind = 'outcome_verified'")).rowCount)).toBe(0);
  });
});

describe('outcomes stay with the campus they were reported at', () => {
  it('a student who reports at A, leaves, and joins B at full is not listed, exported or logged for A', async () => {
    const a = await mkCampus();
    const b = await mkCampus();
    const staffA = await mkStaff(a, 'staff');
    const u = await mkMember(a, { share: 'outcomes' });
    await c.query("UPDATE users SET display_name = 'Leaver Test' WHERE id = $1", [u]);
    await call(u, "INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer, package_lpa) VALUES ($1, $2, $3, 'offer', 'A Employer', 5)", [u, a.campusId, a.cohortId]);
    // While a member of A at outcomes level, A's TPO sees it and the export has it.
    expect(await fn(staffA, 'tpo_list_outcomes', a.campusId, null)).toHaveLength(1);
    expect((await fn(staffA, 'tpo_naac_rows', a.campusId, null)).placements).toHaveLength(1);

    expect(await fn(u, 'campus_leave')).toBe(true);
    await c.query("DELETE FROM tpo_access_log WHERE subject_user_id = $1", [u]);
    await c.query(
      "INSERT INTO cohort_members (user_id, campus_id, cohort_id, verified_via, verified_at, email_hmac, share_level) VALUES ($1, $2, $3, 'email', now(), $4, 'full')",
      [u, b.campusId, b.cohortId, `b-${u}`],
    );
    // B's level (full) must not be applied to A's rows, and A has no membership of this student any more.
    expect(await fn(staffA, 'tpo_list_outcomes', a.campusId, null)).toEqual([]);
    expect(await fn(staffA, 'tpo_naac_rows', a.campusId, null)).toEqual({ placements: [], higherEd: [] });
    expect(await fn(staffA, 'tpo_verify_outcome', (await c.query('SELECT id FROM outcomes WHERE user_id = $1', [u])).rows[0].id)).toBeNull();
    expect((await c.query("SELECT 1 FROM tpo_access_log WHERE subject_user_id = $1 AND campus_id = $2", [u, a.campusId])).rowCount).toBe(0);
    // And B's TPO does not see an outcome that was reported at A.
    const staffB = await mkStaff(b, 'staff');
    expect(await fn(staffB, 'tpo_list_outcomes', b.campusId, null)).toEqual([]);
    expect(await fn(staffB, 'tpo_naac_rows', b.campusId, null)).toEqual({ placements: [], higherEd: [] });
  });
});

describe('leaving a campus and erasure', () => {
  it('a student can leave; deleting the account removes membership, outcomes and log rows', async () => {
    const w = await mkCampus();
    const u = await mkMember(w, { share: 'full' });
    expect(await fn(u, 'campus_leave')).toBe(true);
    expect(await fn(u, 'campus_leave')).toBe(false);
    const v = await mkMember(w, { share: 'full' });
    await call(v, "INSERT INTO outcomes (user_id, campus_id, cohort_id, kind, employer) VALUES ($1, $2, $3, 'offer', 'Gone Co')", [v, w.campusId, w.cohortId]);
    await c.query("INSERT INTO tpo_access_log (campus_id, subject_user_id, action) VALUES ($1, $2, 'outcomes_list')", [w.campusId, v]);
    await c.query("INSERT INTO join_attempts (user_id, kind) VALUES ($1, 'code')", [v]);
    await c.query('DELETE FROM users WHERE id = $1', [v]);
    for (const t of ['cohort_members', 'outcomes', 'join_attempts']) {
      expect((await c.query(`SELECT 1 FROM ${t} WHERE user_id = $1`, [v])).rowCount, t).toBe(0);
    }
    expect((await c.query('SELECT 1 FROM tpo_access_log WHERE subject_user_id = $1', [v])).rowCount).toBe(0);
  });
});
