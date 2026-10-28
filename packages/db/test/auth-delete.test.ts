import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteAccount } from '../src/auth/delete.js';
import { createSession, lookupSession } from '../src/auth/sessions.js';
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
const T0 = new Date('2026-10-29T10:00:00Z');

describe('deleteAccount', () => {
  it('revokes sessions, then hard-deletes the user and everything under it', async () => {
    const u = await mkUser(c);
    const other = await mkUser(c);
    const s = await createSession(c, { userId: u.id, client: 'web', now: T0 });
    await c.query(`INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, 'google', $2)`, [u.id, `g-${u.id}`]);
    await c.query(`INSERT INTO product_events (user_id, event) VALUES ($1, 'x')`, [u.id]);
    const r = await deleteAccount(c, u.id, T0);
    expect(r.deleted).toBe(true);
    expect(r.sessionsRevoked).toBe(1);
    expect(await lookupSession(c, s.token, T0)).toBeNull();
    expect((await c.query('SELECT 1 FROM users WHERE id = $1', [u.id])).rowCount).toBe(0);
    for (const t of ['consents', 'sessions', 'auth_identities', 'product_events']) {
      expect((await c.query(`SELECT 1 FROM ${t} WHERE user_id = $1`, [u.id])).rowCount, t).toBe(0);
    }
    // Someone else's data is untouched.
    expect((await c.query('SELECT 1 FROM users WHERE id = $1', [other.id])).rowCount).toBe(1);
    expect((await c.query('SELECT 1 FROM consents WHERE user_id = $1', [other.id])).rowCount).toBe(1);
  });

  it('reports false for an unknown user and does not throw', async () => {
    const r = await deleteAccount(c, '00000000-0000-4000-8000-000000000001', T0);
    expect(r.deleted).toBe(false);
  });

  it('removes challenges tied to the user', async () => {
    const u = await mkUser(c);
    await c.query(`INSERT INTO otp_challenges (channel, purpose, target_hmac, code_hash, expires_at, user_id) VALUES ('email','campus_email','t','c', now(), $1)`, [u.id]);
    await deleteAccount(c, u.id, T0);
    expect((await c.query('SELECT 1 FROM otp_challenges WHERE user_id = $1', [u.id])).rowCount).toBe(0);
  });
});
