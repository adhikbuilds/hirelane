import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { findSchemaDrift } from '../src/verify-schema-lib.js';
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

const rejects = async (sql: string, params: unknown[] = []): Promise<string | undefined> => {
  try {
    await c.query(sql, params);
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe('0008 auth schema', () => {
  it('matches the Drizzle definitions (no drift)', async () => {
    expect(await findSchemaDrift(c)).toEqual([]);
  });

  it('refuses a users row that has no age_18_plus consent', async () => {
    expect(await rejects(`INSERT INTO users (email) VALUES ('nobody@example.test')`)).toBe('23514');
    const n = await c.query(`SELECT count(*)::int AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM consents k WHERE k.user_id = u.id AND k.kind = 'age_18_plus' AND k.granted)`);
    expect(n.rows[0].n).toBe(0);
  });

  it('refuses a users row whose only age consent is a refusal', async () => {
    const code = await rejects(
      `WITH u AS (INSERT INTO users (email) VALUES ('refused@example.test') RETURNING id)
       INSERT INTO consents (user_id, kind, granted, doc_version) SELECT id, 'age_18_plus', false, 'v' FROM u`,
    );
    expect(code).toBe('23514');
  });

  it('keeps phone columns nullable and unique when present', async () => {
    const u = await mkUser(c);
    const cols = await c.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='users' AND column_name IN ('phone_hmac','phone_enc')`);
    expect(cols.rows.every((r) => r.is_nullable === 'YES')).toBe(true);
    expect(cols.rowCount).toBe(2);
    await c.query(`UPDATE users SET phone_hmac = 'h1' WHERE id = $1`, [u.id]);
    const other = await mkUser(c);
    expect(await rejects(`UPDATE users SET phone_hmac = 'h1' WHERE id = $1`, [other.id])).toBe('23505');
  });

  it('treats email case-insensitively', async () => {
    await mkUser(c, 'case@example.test');
    expect(await rejects(`INSERT INTO users (email) VALUES ('CASE@example.test')`)).toBe('23505');
  });

  it('constrains provider, client, channel, purpose and consent kind', async () => {
    const u = await mkUser(c);
    expect(await rejects(`INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, 'password', 's')`, [u.id])).toBe('23514');
    for (const p of ['google', 'email_otp', 'phone_otp', 'linkedin']) {
      expect(await rejects(`INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, $2, $3)`, [u.id, p, `sub-${p}`])).toBeUndefined();
    }
    expect(await rejects(`INSERT INTO sessions (id_hash, user_id, client, expires_at, absolute_expires_at) VALUES ('x', $1, 'ios', now(), now())`, [u.id])).toBe('23514');
    expect(await rejects(`INSERT INTO otp_challenges (channel, purpose, target_hmac, code_hash, expires_at) VALUES ('fax', 'login', 't', 'c', now())`)).toBe('23514');
    expect(await rejects(`INSERT INTO otp_challenges (channel, purpose, target_hmac, code_hash, expires_at) VALUES ('email', 'signup', 't', 'c', now())`)).toBe('23514');
    expect(await rejects(`INSERT INTO otp_challenges (channel, purpose, target_hmac, code_hash, expires_at, attempts) VALUES ('email', 'login', 't', 'c', now(), 6)`)).toBe('23514');
    for (const k of ['age_18_plus', 'terms', 'privacy', 'campus_share', 'offer_letter_tpo']) {
      expect(await rejects(`INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, $2, true, 'v')`, [u.id, k])).toBeUndefined();
    }
    expect(await rejects(`INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, 'sell_my_data', true, 'v')`, [u.id])).toBe('23514');
  });

  it('keeps product events free of PII-shaped props', async () => {
    const u = await mkUser(c);
    expect(await rejects(`INSERT INTO product_events (user_id, event, props) VALUES ($1, 'signup', '{"step":"welcome"}')`, [u.id])).toBeUndefined();
    expect(await rejects(`INSERT INTO product_events (user_id, event, props) VALUES ($1, 'signup', '{"email":"a@example.test"}')`, [u.id])).toBe('23514');
  });

  it('leaves the accounts flag off', async () => {
    const r = await c.query(`SELECT enabled FROM feature_flags WHERE key = 'accounts' AND user_id IS NULL`);
    expect(r.rows.every((x) => x.enabled === false)).toBe(true);
  });

  it('deleting a user cascades through every child table', async () => {
    const u = await mkUser(c);
    await c.query(`INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, 'google', $2)`, [u.id, `g-${u.id}`]);
    await c.query(`INSERT INTO sessions (id_hash, user_id, client, expires_at, absolute_expires_at) VALUES ($2, $1, 'web', now(), now())`, [u.id, `h-${u.id}`]);
    await c.query(`INSERT INTO product_events (user_id, event) VALUES ($1, 'x')`, [u.id]);
    await c.query(`INSERT INTO idempotency_keys (user_id, key) VALUES ($1, 'k1')`, [u.id]);
    await c.query(`DELETE FROM users WHERE id = $1`, [u.id]);
    for (const t of ['auth_identities', 'sessions', 'product_events', 'idempotency_keys', 'consents']) {
      const r = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [u.id]);
      expect(r.rows[0].n, t).toBe(0);
    }
  });

  it('the app role holds no privileges on sessions, otp_challenges or auth_identities', async () => {
    for (const t of ['sessions', 'otp_challenges', 'auth_identities']) {
      const r = await c.query(`SELECT has_table_privilege('hirelane_app', $1, 'SELECT,INSERT,UPDATE,DELETE') AS any`, [t]);
      expect(r.rows[0].any, t).toBe(false);
      const sel = await c.query(`SELECT has_table_privilege('hirelane_app', $1, 'SELECT') AS s`, [t]);
      expect(sel.rows[0].s, t).toBe(false);
    }
  });
});
