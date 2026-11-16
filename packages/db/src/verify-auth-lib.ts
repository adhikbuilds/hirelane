import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { deleteAccount } from './auth/delete.js';
import { issueChallenge, OTP_MAX_ATTEMPTS, OTP_TTL_MS, verifyChallenge } from './auth/otp.js';
import { ABSOLUTE_TTL_MS, createSession, IDLE_TTL_MS, lookupSession, revokeSession, rotateSession } from './auth/sessions.js';
import { isLocalUrl } from './env.js';

/**
 * Account invariants harness (pnpm db:verify-auth). Runs against the migrated database with synthetic rows
 * (`verify-auth-*@example.test`) that it removes again. Local database only. Complements db:verify-rls, which
 * proves row isolation; this proves the behaviour the auth tables promise.
 */
export interface AuthReport {
  checks: number;
  failures: string[];
}

export interface VerifyAuthOptions {
  url: string;
}

const T0 = new Date('2030-01-01T10:00:00Z');
const plus = (ms: number) => new Date(T0.getTime() + ms);
const PREFIX = 'verify-auth-';

async function errCode(admin: Client, sql: string, params: unknown[] = []): Promise<string | undefined> {
  await admin.query('SAVEPOINT chk');
  try {
    await admin.query(sql, params);
    await admin.query('RELEASE SAVEPOINT chk');
    return undefined;
  } catch (e) {
    await admin.query('ROLLBACK TO SAVEPOINT chk');
    return (e as { code?: string }).code ?? 'unknown';
  }
}

/** Runs one statement as the unprivileged app role with a user context, inside the open transaction. */
async function asApp(admin: Client, userId: string, sql: string, params: unknown[] = []): Promise<{ code?: string; rowCount: number | null }> {
  await admin.query('SAVEPOINT app');
  try {
    await admin.query('SET LOCAL ROLE hirelane_app');
    await admin.query("SELECT set_config('hirelane.user_id', $1, true)", [userId]);
    const r = await admin.query(sql, params);
    return { rowCount: r.rowCount };
  } catch (e) {
    return { code: (e as { code?: string }).code ?? 'unknown', rowCount: null };
  } finally {
    await admin.query('ROLLBACK TO SAVEPOINT app');
    await admin.query('RESET ROLE');
  }
}

async function mkUser(admin: Client): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `WITH u AS (INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now()) RETURNING id)
     INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', true, 'verify-auth' FROM u`,
    [id, `${PREFIX}${id}@example.test`],
  );
  return id;
}

export async function verifyAuth(admin: Client, opts: VerifyAuthOptions): Promise<AuthReport> {
  if (!isLocalUrl(opts.url)) throw new Error('verify-auth writes synthetic rows, so it only runs against a local database');
  const report: AuthReport = { checks: 0, failures: [] };
  const ok = (cond: boolean, msg: string): void => {
    report.checks++;
    if (!cond) report.failures.push(msg);
  };
  const targets: string[] = [];
  const users: string[] = [];
  const target = (): string => {
    const t = `${PREFIX}${randomUUID()}`;
    targets.push(t);
    return t;
  };
  const hashFor = (code: string) => (id: string) => `h(${id}:${code})`;
  const issue = async (t: string, code: string, now = T0): Promise<void> => {
    const id = randomUUID();
    await issueChallenge(admin, { id, channel: 'email', purpose: 'login', targetHmac: t, codeHash: hashFor(code)(id), now });
  };
  const verify = (t: string, code: string, now = T0) => verifyChallenge(admin, { targetHmac: t, purpose: 'login', hashFor: hashFor(code), now });

  try {
    // 18+ gate: a database guarantee.
    const unconsented = await admin.query(
      `SELECT count(*)::int AS n FROM users u WHERE NOT EXISTS (
         SELECT 1 FROM consents k WHERE k.user_id = u.id AND k.kind = 'age_18_plus' AND k.granted)`,
    );
    ok(unconsented.rows[0].n === 0, `${unconsented.rows[0].n} users rows have no age_18_plus consent`);

    await admin.query('BEGIN');
    const bad = await errCode(admin, `INSERT INTO users (email) VALUES ($1)`, [`${PREFIX}${randomUUID()}@example.test`]);
    const badAtCommit = await errCode(admin, 'SET CONSTRAINTS ALL IMMEDIATE');
    await admin.query('ROLLBACK');
    ok(bad !== undefined || badAtCommit !== undefined, 'a users row without an age_18_plus consent was accepted (the age_18_plus gate is not enforced)');

    const refusedId = randomUUID();
    await admin.query('BEGIN');
    await admin.query(`INSERT INTO users (id, email) VALUES ($1, $2)`, [refusedId, `${PREFIX}${refusedId}@example.test`]);
    await admin.query(`INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'age_18_plus', false, 'v')`, [refusedId]);
    const refusedCode = await errCode(admin, 'SET CONSTRAINTS ALL IMMEDIATE');
    await admin.query('ROLLBACK');
    ok(refusedCode !== undefined, 'a users row whose age_18_plus consent is a refusal (granted=false) was accepted');

    const u = await mkUser(admin);
    users.push(u);
    const cols = await admin.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('phone_hmac','phone_enc') AND is_nullable = 'YES'`);
    ok(cols.rows[0].n === 2, 'users.phone_hmac and users.phone_enc must both be nullable');

    // Sessions.
    const s = await createSession(admin, { userId: u, client: 'web', now: T0 });
    const stored = await admin.query('SELECT id_hash FROM sessions WHERE user_id = $1', [u]);
    ok(stored.rows[0]?.id_hash !== s.token && stored.rows[0]?.id_hash === s.idHash, 'sessions.id_hash must be a hash of the token, never the token');
    ok((await lookupSession(admin, s.token, T0))?.userId === u, 'a fresh session does not resolve to its user');
    ok(await revokeSession(admin, s.token, T0), 'logout did not revoke the session');
    ok((await lookupSession(admin, s.token, T0)) === null, 'a revoked session still resolves (logout must revoke server-side)');

    const idle = await createSession(admin, { userId: u, client: 'web', now: T0 });
    ok((await lookupSession(admin, idle.token, plus(IDLE_TTL_MS + 1000))) === null, 'a session past its idle expiry still resolves');

    const abs = await createSession(admin, { userId: u, client: 'android', now: T0 });
    let t = 0;
    while (t + IDLE_TTL_MS / 2 < ABSOLUTE_TTL_MS) {
      t += IDLE_TTL_MS / 2;
      await lookupSession(admin, abs.token, plus(t));
    }
    ok((await lookupSession(admin, abs.token, plus(ABSOLUTE_TTL_MS + 1000))) === null, 'sliding expiry outlived the absolute expiry');

    const before = await createSession(admin, { userId: u, client: 'web', now: T0 });
    const after = await rotateSession(admin, before.token, { userId: u, client: 'web', now: T0 });
    ok((await lookupSession(admin, before.token, T0)) === null && (await lookupSession(admin, after.token, T0)) !== null, 'login rotation did not retire the previous session token');

    // OTP.
    const t1 = target();
    await issue(t1, '123456');
    ok((await verify(t1, '123456')).ok === true, 'the right code was refused');
    ok((await verify(t1, '123456')).ok === false, 'a code worked twice (single use)');

    const t2 = target();
    await issue(t2, '234567');
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) await verify(t2, '000000');
    ok((await verify(t2, '234567')).ok === false, 'the 6th attempt was accepted (limit is 5)');

    const t3 = target();
    await issue(t3, '345678');
    ok((await verify(t3, '345678', plus(OTP_TTL_MS + 1))).ok === false, 'an expired code was accepted');

    const t4 = target();
    await issue(t4, '456789');
    const wrong = JSON.stringify(await verify(t4, '000000'));
    ok(wrong === JSON.stringify(await verify(target(), '456789')), 'wrong code and unknown target answer differently (enumeration leak)');

    // The app role must not reach auth internals.
    await admin.query('BEGIN');
    for (const tbl of ['sessions', 'otp_challenges', 'auth_identities']) {
      const r = await asApp(admin, u, `SELECT 1 FROM ${tbl}`);
      ok(r.code === '42501', `${tbl}: readable by the app role (it must be revoked)`);
    }
    // Consents are append-only for the app role.
    const upd = await asApp(admin, u, `UPDATE consents SET granted = false WHERE user_id = $1`, [u]);
    const del = await asApp(admin, u, `DELETE FROM consents WHERE user_id = $1`, [u]);
    ok(upd.code === '42501' && del.code === '42501', 'consents: the app role can update or delete a row (it must stay append-only)');
    const ins = await asApp(admin, u, `INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'terms', true, 'v1')`, [u]);
    ok(ins.code === undefined, `consents: the app role cannot record its own consent${ins.code ? ` (${ins.code})` : ''}`);
    const pii = await asApp(admin, u, `INSERT INTO product_events (user_id, event, props) VALUES ($1, 'x', '{"email":"a@example.test"}')`, [u]);
    ok(pii.code === '23514', 'product_events accepted a props key that looks like PII');
    await admin.query('ROLLBACK');

    // Identities are unique per provider subject.
    const sub = `${PREFIX}${randomUUID()}`;
    await admin.query(`INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, 'google', $2)`, [u, sub]);
    const other = await mkUser(admin);
    users.push(other);
    await admin.query('BEGIN');
    const dup = await errCode(admin, `INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, 'google', $2)`, [other, sub]);
    await admin.query('ROLLBACK');
    ok(dup === '23505', 'the same google subject could be attached to two users');

    // Account delete: revoke, then hard-delete with cascade.
    const live = await createSession(admin, { userId: other, client: 'web', now: T0 });
    await admin.query(`INSERT INTO product_events (user_id, event) VALUES ($1, 'verify_auth')`, [other]);
    const res = await deleteAccount(admin, other, T0);
    users.splice(users.indexOf(other), 1);
    ok(res.deleted && res.sessionsRevoked === 1, 'deleteAccount did not report the revoked session and the delete');
    ok((await lookupSession(admin, live.token, T0)) === null, 'a session survived account deletion');
    let left = 0;
    for (const tbl of ['users', 'consents', 'sessions', 'auth_identities', 'product_events']) {
      const col = tbl === 'users' ? 'id' : 'user_id';
      left += (await admin.query(`SELECT count(*)::int AS n FROM ${tbl} WHERE ${col} = $1`, [other])).rows[0].n;
    }
    ok(left === 0, `${left} rows survived account deletion`);
  } finally {
    await admin.query('ROLLBACK').catch(() => undefined);
    await admin.query('RESET ROLE').catch(() => undefined);
    if (users.length > 0) await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]).catch(() => undefined);
    await admin.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%@example.test`]).catch(() => undefined);
    if (targets.length > 0) await admin.query('DELETE FROM otp_challenges WHERE target_hmac = ANY($1::text[])', [targets]).catch(() => undefined);
  }
  return report;
}
