import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { mkJob } from './apply-helpers.js';
import { mkUser } from './auth-helpers.js';
import { freshTestClient } from './helpers.js';

/** 0012: applications state machine, evidence rule, grants. Synthetic data only. */
let c: Client;
beforeAll(async () => {
  c = await freshTestClient();
  await applyMigrations(c, resolve(import.meta.dirname, '../migrations'));
});
afterAll(async () => {
  await c.end();
});

async function asApp<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    await c.query('SET LOCAL ROLE hirelane_app');
    await c.query("SELECT set_config('hirelane.user_id', $1, true)", [userId]);
    const out = await fn();
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
}
const sqlstate = async (fn: () => Promise<unknown>): Promise<{ code?: string; constraint?: string } | undefined> => {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e as { code?: string; constraint?: string };
  }
};
async function swipe(userId: string, jobId: string): Promise<string> {
  const id = randomUUID();
  await asApp(userId, () => c.query('INSERT INTO applications (id, user_id, job_id) VALUES ($1, $2, $3)', [id, userId, jobId]));
  return id;
}
const status = async (id: string): Promise<string> => (await c.query('SELECT status FROM applications WHERE id = $1', [id])).rows[0].status;
const expire = (id: string) => c.query("UPDATE applications SET undo_until = now() - interval '1 second' WHERE id = $1", [id]);

describe('applications insert', () => {
  it('forces status ready, a 4 second window and the snapshot from the job, whatever the caller sends', async () => {
    const u = await mkUser(c);
    const j = await mkJob(c, { ats: 'lever' });
    const id = await swipe(u.id, j.jobId);
    const r = (await c.query('SELECT *, undo_until - created_at AS win FROM applications WHERE id = $1', [id])).rows[0];
    expect(r.status).toBe('ready');
    expect(r.platform).toBe('lever');
    expect(r.apply_url).toMatch(/^https:\/\/lever\.fixture\.invalid\//);
    expect(r.company_name).toMatch(/^Acme /);
    expect(r.win.seconds).toBe(4);
  });

  it('the app role cannot choose the apply URL or the status (column grants)', async () => {
    const u = await mkUser(c);
    const j = await mkJob(c);
    for (const col of ['apply_url', 'status', 'undo_until', 'platform', 'blocked_reason']) {
      const e = await sqlstate(() =>
        asApp(u.id, () => c.query(`INSERT INTO applications (user_id, job_id, ${col}) VALUES ($1, $2, ${col === 'undo_until' ? "now()" : "'x'"})`, [u.id, j.jobId])),
      );
      expect(e?.code, col).toBe('42501');
    }
  });

  it('falls back to the posting url, refuses an unknown job and a closed job, naming the constraint', async () => {
    const u = await mkUser(c);
    const none = await mkJob(c, { applyUrl: null });
    // postings.url is NOT NULL, so a null apply_url falls back to the posting url: still a target.
    expect(await sqlstate(() => swipe(u.id, none.jobId))).toBeUndefined();
    const closed = await mkJob(c, { closed: true });
    expect((await sqlstate(() => swipe(u.id, closed.jobId)))?.constraint).toBe('applications_job_open');
    const ghost = await sqlstate(() => asApp(u.id, () => c.query('INSERT INTO applications (user_id, job_id) VALUES ($1, $2)', [u.id, randomUUID()])));
    expect(ghost?.constraint).toBe('applications_apply_target');
  });

  it('is one application per student and job', async () => {
    const u = await mkUser(c);
    const j = await mkJob(c);
    await swipe(u.id, j.jobId);
    expect((await sqlstate(() => swipe(u.id, j.jobId)))?.constraint).toBe('applications_user_job_uq');
  });
});

describe('the state machine', () => {
  it('lets the worker claim only after the undo window, then finish', async () => {
    const u = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    const early = await sqlstate(() => c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]));
    expect(early?.constraint).toBe('applications_transition');
    await expire(id);
    await c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]);
    const claimed = (await c.query('SELECT claimed_at FROM applications WHERE id = $1', [id])).rows[0];
    expect(claimed.claimed_at).not.toBeNull();
    await c.query("UPDATE applications SET status = 'submitted' WHERE id = $1", [id]);
    const done = (await c.query('SELECT status, submitted_at FROM applications WHERE id = $1', [id])).rows[0];
    expect(done.status).toBe('submitted');
    expect(done.submitted_at).not.toBeNull();
  });

  it('refuses every other move, for the owner as well', async () => {
    const u = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    await expire(id);
    expect((await sqlstate(() => c.query("UPDATE applications SET status = 'submitted' WHERE id = $1", [id])))?.constraint).toBe('applications_transition');
    await c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]);
    await c.query("UPDATE applications SET status = 'blocked_fallback', blocked_reason = 'captcha', fallback_note = 'finish on their site' WHERE id = $1", [id]);
    for (const to of ['ready', 'submitting', 'submitted', 'failed', 'undone']) {
      expect((await sqlstate(() => c.query('UPDATE applications SET status = $2 WHERE id = $1', [id, to])))?.constraint, to).toBe('applications_transition');
    }
  });

  it('re-arms a "needs you" application (fresh window), but no other blocked reason', async () => {
    const u = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    await expire(id);
    await c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]);
    await c.query("UPDATE applications SET status = 'blocked_fallback', blocked_reason = 'needs_you', fallback_note = 'finish on their site' WHERE id = $1", [id]);
    await asApp(u.id, () => c.query("UPDATE applications SET status = 'ready' WHERE id = $1", [id]));
    const r = (await c.query('SELECT status, blocked_reason, fallback_note, claimed_at, undo_until > now() AS open FROM applications WHERE id = $1', [id])).rows[0];
    expect(r).toEqual({ status: 'ready', blocked_reason: null, fallback_note: null, claimed_at: null, open: true });
    // It can be claimed again after the window, and the state machine goes on as before.
    await expire(id);
    await c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]);
    await c.query("UPDATE applications SET status = 'blocked_fallback', blocked_reason = 'captcha', fallback_note = 'x' WHERE id = $1", [id]);
    expect((await sqlstate(() => asApp(u.id, () => c.query("UPDATE applications SET status = 'ready' WHERE id = $1", [id]))))?.constraint).toBe('applications_transition');
  });

  it('lets the student mark a blocked application as finished on the employer site; the worker cannot', async () => {
    const u = await mkUser(c);
    const other = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    await expire(id);
    await c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]);
    await c.query("UPDATE applications SET status = 'blocked_fallback', blocked_reason = 'captcha', fallback_note = 'finish on their site' WHERE id = $1", [id]);
    expect((await sqlstate(() => c.query("UPDATE applications SET status = 'submitted' WHERE id = $1", [id])))?.constraint).toBe('applications_transition');
    await asApp(other.id, () => c.query("UPDATE applications SET status = 'submitted' WHERE id = $1", [id]));
    expect(await status(id)).toBe('blocked_fallback'); // another student's update sees no row (RLS)
    await asApp(u.id, () => c.query("UPDATE applications SET status = 'submitted' WHERE id = $1", [id]));
    const r = (await c.query('SELECT status, manual_finish, submitted_at IS NOT NULL AS at, blocked_reason, fallback_note FROM applications WHERE id = $1', [id])).rows[0];
    expect(r).toEqual({ status: 'submitted', manual_finish: true, at: true, blocked_reason: null, fallback_note: null });
  });

  it('lets the worker put an over-cap application back as ready, and the app role cannot', async () => {
    const u = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    await expire(id);
    await c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]);
    expect((await sqlstate(() => asApp(u.id, () => c.query("UPDATE applications SET status = 'ready' WHERE id = $1", [id]))))?.constraint).toBe('applications_transition');
    await c.query("UPDATE applications SET status = 'ready' WHERE id = $1", [id]);
    const r = (await c.query('SELECT status, claimed_at FROM applications WHERE id = $1', [id])).rows[0];
    expect(r).toEqual({ status: 'ready', claimed_at: null });
  });

  it('a login role that is a member of hirelane_app is treated as the app, not as the worker', async () => {
    const u = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    await expire(id);
    const role = `hl_member_${randomUUID().slice(0, 8)}`;
    await c.query(`CREATE ROLE ${role} NOLOGIN IN ROLE hirelane_app`);
    await c.query(`GRANT UPDATE (status) ON applications TO ${role}`);
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL ROLE ${role}`);
      await c.query("SELECT set_config('hirelane.user_id', $1, true)", [u.id]);
      const e = await sqlstate(() => c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]));
      expect(e?.constraint).toBe('applications_transition');
    } finally {
      await c.query('ROLLBACK');
      await c.query(`REVOKE UPDATE (status) ON applications FROM ${role}`);
      await c.query(`DROP ROLE ${role}`);
    }
  });

  it('lets the app role undo inside the window and nothing else', async () => {
    const u = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    for (const to of ['submitting', 'submitted', 'blocked_fallback', 'failed']) {
      const e = await sqlstate(() => asApp(u.id, () => c.query('UPDATE applications SET status = $2 WHERE id = $1', [id, to])));
      expect(e?.constraint, to).toBe('applications_transition');
    }
    await asApp(u.id, () => c.query("UPDATE applications SET status = 'undone' WHERE id = $1", [id]));
    expect(await status(id)).toBe('undone');
  });

  it('refuses an undo after the window, and a claim after an undo', async () => {
    const u = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    await expire(id);
    expect((await sqlstate(() => asApp(u.id, () => c.query("UPDATE applications SET status = 'undone' WHERE id = $1", [id]))))?.constraint).toBe('applications_transition');
    const id2 = await swipe(u.id, (await mkJob(c)).jobId);
    await asApp(u.id, () => c.query("UPDATE applications SET status = 'undone' WHERE id = $1", [id2]));
    await expire(id2);
    expect((await sqlstate(() => c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id2])))?.constraint).toBe('applications_transition');
  });

  it('a fresh swipe after an undo reopens the window', async () => {
    const u = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    await asApp(u.id, () => c.query("UPDATE applications SET status = 'undone' WHERE id = $1", [id]));
    await asApp(u.id, () => c.query("UPDATE applications SET status = 'ready' WHERE id = $1", [id]));
    const r = (await c.query('SELECT status, undo_until > now() AS open FROM applications WHERE id = $1', [id])).rows[0];
    expect(r).toEqual({ status: 'ready', open: true });
  });

  it('freezes identity columns and cannot be edited by the app role beyond status', async () => {
    const u = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    expect((await sqlstate(() => c.query("UPDATE applications SET apply_url = 'https://x.invalid/' WHERE id = $1", [id])))?.constraint).toBe('applications_immutable');
    expect((await sqlstate(() => asApp(u.id, () => c.query("UPDATE applications SET undo_until = now() + interval '1 day' WHERE id = $1", [id]))))?.code).toBe('42501');
  });

  it('a job can be deleted after students applied to it: the application stays, detached (job_id NULL), and a company delete cascades the same way', async () => {
    const u = await mkUser(c);
    const j = await mkJob(c);
    const id = await swipe(u.id, j.jobId);
    await c.query('DELETE FROM jobs WHERE id = $1', [j.jobId]);
    const r = (await c.query('SELECT job_id, status, company_name FROM applications WHERE id = $1', [id])).rows[0];
    expect(r).toMatchObject({ job_id: null, status: 'ready' });
    const j2 = await mkJob(c);
    const id2 = await swipe(u.id, j2.jobId);
    await c.query('DELETE FROM companies WHERE id = $1', [j2.companyId]);
    expect((await c.query('SELECT job_id FROM applications WHERE id = $1', [id2])).rows[0].job_id).toBeNull();
  });

  it('job_id can go to NULL but never to another job', async () => {
    const u = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    const other = await mkJob(c);
    expect((await sqlstate(() => c.query('UPDATE applications SET job_id = $2 WHERE id = $1', [id, other.jobId])))?.constraint).toBe('applications_immutable');
  });

  it('keeps one student from touching another student', async () => {
    const a = await mkUser(c);
    const b = await mkUser(c);
    const id = await swipe(a.id, (await mkJob(c)).jobId);
    const r = await asApp(b.id, () => c.query("UPDATE applications SET status = 'undone' WHERE id = $1", [id]));
    expect(r.rowCount).toBe(0);
    expect((await asApp(b.id, () => c.query('SELECT 1 FROM applications WHERE id = $1', [id]))).rowCount).toBe(0);
  });

  it('only one of a racing undo and claim wins', async () => {
    const u = await mkUser(c);
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    // Window still open: the claim loses, the undo wins.
    const early = await sqlstate(() => c.query("UPDATE applications SET status = 'submitting' WHERE id = $1 AND undo_until <= now()", [id]));
    expect(early).toBeUndefined();
    expect(await status(id)).toBe('ready');
    await expire(id);
    const claim = await c.query("UPDATE applications SET status = 'submitting' WHERE id = $1 AND status = 'ready' AND undo_until <= now() RETURNING id", [id]);
    expect(claim.rowCount).toBe(1);
    const undo = await asApp(u.id, () => c.query("UPDATE applications SET status = 'undone' WHERE id = $1 AND status = 'ready' AND undo_until > now() RETURNING id", [id]));
    expect(undo.rowCount).toBe(0);
  });
});

describe('answers, receipts, inbound, notifications, switches', () => {
  async function submitting(u: { id: string }): Promise<string> {
    const id = await swipe(u.id, (await mkJob(c)).jobId);
    await expire(id);
    await c.query("UPDATE applications SET status = 'submitting' WHERE id = $1", [id]);
    return id;
  }

  it('an answer needs evidence, a needs-you row has none', async () => {
    const u = await mkUser(c);
    const id = await submitting(u);
    const ins = (cols: string, vals: string) => c.query(`INSERT INTO application_answers (application_id, user_id, field_id, label, ${cols}) VALUES ($1, $2, $3, 'L', ${vals})`, [id, u.id, randomUUID()]);
    expect((await sqlstate(() => ins('needs_you, answer_enc, evidence_enc, evidence_sources', "false, '\\x01', '\\x02', '{}'")))?.constraint).toBe('application_answers_evidence');
    expect((await sqlstate(() => ins('needs_you, answer_enc, evidence_enc, evidence_sources', "false, '\\x01', NULL, '{profile:email}'")))?.constraint).toBe('application_answers_evidence');
    expect((await sqlstate(() => ins('needs_you, answer_enc, evidence_enc, evidence_sources', "true, '\\x01', NULL, '{}'")))?.constraint).toBe('application_answers_evidence');
    expect(await sqlstate(() => ins('needs_you, answer_enc, evidence_enc, evidence_sources', "false, '\\x01', '\\x02', '{profile:email}'"))).toBeUndefined();
    expect(await sqlstate(() => ins('needs_you, reason', "true, 'ask'"))).toBeUndefined();
  });

  it('the app role reads its own answers and receipts but cannot write them', async () => {
    const u = await mkUser(c);
    const id = await submitting(u);
    await c.query("INSERT INTO receipts (application_id, user_id, answers_hash, platform, result_code, sent) VALUES ($1, $2, repeat('a', 64), 'greenhouse', 'accepted', true)", [id, u.id]);
    expect((await asApp(u.id, () => c.query('SELECT 1 FROM receipts'))).rowCount).toBe(1);
    expect((await sqlstate(() => asApp(u.id, () => c.query("INSERT INTO receipts (application_id, user_id, answers_hash, platform, result_code, sent) VALUES ($1, $2, repeat('b', 64), 'lever', 'accepted', true)", [id, u.id]))))?.code).toBe('42501');
    expect((await sqlstate(() => asApp(u.id, () => c.query("INSERT INTO application_answers (application_id, user_id, field_id, label, needs_you) VALUES ($1, $2, 'f', 'L', true)", [id, u.id]))))?.code).toBe('42501');
    expect((await sqlstate(() => c.query("INSERT INTO receipts (application_id, user_id, answers_hash, platform, result_code, sent) VALUES ($1, $2, repeat('c', 64), 'lever', 'accepted', true)", [id, u.id])))?.constraint).toBe('receipts_app_uq');
  });

  it('platform_switches is invisible to the app role and seeded enabled', async () => {
    const rows = (await c.query('SELECT platform, enabled FROM platform_switches ORDER BY platform')).rows;
    expect(rows).toEqual([{ platform: 'ashby', enabled: true }, { platform: 'greenhouse', enabled: true }, { platform: 'lever', enabled: true }]);
    const u = await mkUser(c);
    expect((await sqlstate(() => asApp(u.id, () => c.query('SELECT 1 FROM platform_switches'))))?.code).toBe('42501');
  });

  it('apply addresses: the app role inserts handle, domain and reply handle only; the cap defaults and cannot be raised', async () => {
    const u = await mkUser(c);
    await asApp(u.id, () => c.query("INSERT INTO apply_addresses (user_id, handle, domain, reply_handle) VALUES ($1, 'asha.k3x', 'apply.example.test', 'ab12cd34ef')", [u.id]));
    expect((await c.query('SELECT daily_cap FROM apply_addresses WHERE user_id = $1', [u.id])).rows[0].daily_cap).toBe(20);
    const raise = await sqlstate(() => asApp(u.id, () => c.query('UPDATE apply_addresses SET daily_cap = 200')));
    expect(raise?.code).toBe('42501');
    const u2 = await mkUser(c);
    for (const handle of ['admin.k3x', 'a', 'Asha', 'as..ha']) {
      const e = await sqlstate(() => asApp(u2.id, () => c.query("INSERT INTO apply_addresses (user_id, handle, domain, reply_handle) VALUES ($1, $2, 'apply.example.test', 'zz12cd34ef')", [u2.id, handle])));
      expect(e?.code, handle).toBe('23514');
    }
    const dup = await sqlstate(() => asApp(u2.id, () => c.query("INSERT INTO apply_addresses (user_id, handle, domain, reply_handle) VALUES ($1, 'asha.k3x', 'apply.example.test', 'yy12cd34ef')", [u2.id])));
    expect(dup?.constraint).toBe('apply_addresses_address_uq');
  });

  it('inbound kinds are closed, and auto_apply is a consent kind', async () => {
    const u = await mkUser(c);
    const bad = await sqlstate(() =>
      c.query("INSERT INTO inbound_messages (user_id, message_id, employer, from_domain, kind, matched_by, excerpt_enc, received_at) VALUES ($1, 'm1', 'E', 'e.test', 'offer', 'none', '\\x00', now())", [u.id]),
    );
    expect(bad?.constraint).toBe('inbound_kind');
    await c.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'auto_apply', true, 'v1')", [u.id]);
    await asApp(u.id, () => c.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'auto_apply', false, 'v1')", [u.id]));
  });
});
