import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { mkUser } from './auth-helpers.js';
import { freshTestClient } from './helpers.js';

let c: Client;
beforeAll(async () => {
  c = await freshTestClient();
  await applyMigrations(c, resolve(import.meta.dirname, '../migrations'));
});
afterAll(async () => {
  await c.end();
});

const code = async (sql: string, params: unknown[] = []): Promise<string | undefined> => {
  try {
    await c.query(sql, params);
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};
/** Run `fn` as `role` inside a rolled-back transaction. */
async function asRole<T>(role: string, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    await c.query(`SET LOCAL ROLE ${role}`);
    if (userId) await c.query("SELECT set_config('hirelane.user_id', $1, true)", [userId]);
    return await fn();
  } finally {
    await c.query('ROLLBACK');
  }
}

describe('0009 consents cannot be forged by the app role', () => {
  it('refuses an age_18_plus consent and a client-chosen timestamp', async () => {
    const u = await mkUser(c);
    await asRole('hirelane_app', u.id, async () => {
      expect(await code(`INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'age_18_plus', true, 'x')`, [u.id])).toBeDefined();
    });
    await asRole('hirelane_app', u.id, async () => {
      expect(await code(`INSERT INTO consents (user_id, kind, granted, doc_version, at) VALUES ($1, 'terms', true, 'x', '2000-01-01')`, [u.id])).toBe('42501');
    });
  });
  it('still lets the app role record an ordinary consent, stamped with server time', async () => {
    const u = await mkUser(c);
    await asRole('hirelane_app', u.id, async () => {
      expect(await code(`INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'analytics', true, 'x')`, [u.id])).toBeUndefined();
    });
  });
});

describe('0009 product_events PII guard', () => {
  const props = (o: unknown) => JSON.stringify(o);
  it.each([
    [{ email: 'a' }],
    [{ Email: 'a' }],
    [{ meta: { email: 'a' } }],
    [{ list: [{ Phone: '1' }] }],
    [{ a: { b: { AADHAAR: 'x' } } }],
  ])('rejects %j', async (o) => {
    const u = await mkUser(c);
    expect(await code(`INSERT INTO product_events (user_id, event, props) VALUES ($1, 'e', $2::jsonb)`, [u.id, props(o)])).toBe('23514');
  });
  it('accepts harmless props', async () => {
    const u = await mkUser(c);
    expect(await code(`INSERT INTO product_events (user_id, event, props) VALUES ($1, 'e', $2::jsonb)`, [u.id, props({ step: 3, nested: { ok: [1, 2] } })])).toBeUndefined();
  });
});

describe('0009 hirelane_auth is a narrow role', () => {
  it('exists, cannot bypass RLS, and owns nothing', async () => {
    const r = await c.query(`SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'hirelane_auth'`);
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: false });
    const owned = await c.query(`SELECT count(*)::int AS n FROM pg_class WHERE relowner = 'hirelane_auth'::regrole`);
    expect(owned.rows[0].n).toBe(0);
  });
  it('reaches the auth tables and nothing else', async () => {
    for (const t of ['sessions', 'otp_challenges', 'auth_identities', 'rate_limits', 'users', 'consents', 'feature_flags']) {
      const r = await c.query(`SELECT has_table_privilege('hirelane_auth', $1, 'SELECT') AS ok`, [t]);
      expect(r.rows[0].ok, t).toBe(true);
    }
    for (const t of ['product_events', 'idempotency_keys', 'postings', 'companies', 'jobs']) {
      const r = await c.query(`SELECT to_regclass($1) IS NOT NULL AS there`, [t]);
      if (!r.rows[0].there) continue;
      const p = await c.query(`SELECT has_table_privilege('hirelane_auth', $1, 'SELECT,INSERT,UPDATE,DELETE') AS ok`, [t]);
      expect(p.rows[0].ok, t).toBe(false);
    }
  });
  it('can run the sign-up and sign-in statements', async () => {
    const id = randomUUID();
    await asRole('hirelane_auth', null, async () => {
      await c.query(`INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, now())`, [id, `x-${id}@example.test`]);
      await c.query(`INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'age_18_plus', true, 'x')`, [id]);
      await c.query(`INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, 'email_otp', $2)`, [id, `s-${id}`]);
      const r = await c.query(`SELECT user_id FROM auth_identities WHERE subject = $1`, [`s-${id}`]);
      expect(r.rowCount).toBe(1);
      await c.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [id]);
      await c.query(`DELETE FROM users WHERE id = $1`, [id]);
    });
  });
  it('cannot change a user role or email', async () => {
    const u = await mkUser(c);
    await asRole('hirelane_auth', null, async () => {
      expect(await code(`UPDATE users SET email = 'y@example.test' WHERE id = $1`, [u.id])).toBe('42501');
    });
  });
});

describe('runAsRole', () => {
  it('switches to hirelane_auth for the callback and back afterwards, even on error', async () => {
    const { runAsRole } = await import('../src/client.js');
    const who = async () => (await c.query('SELECT current_user AS u')).rows[0].u as string;
    const before = await who();
    const out = await runAsRole(c, 'hirelane_auth', async () => who());
    expect(out.result).toBe('hirelane_auth');
    expect(out.reset).toBe(true);
    expect(await who()).toBe(before);
    await expect(runAsRole(c, 'hirelane_auth', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await who()).toBe(before);
  });
});
