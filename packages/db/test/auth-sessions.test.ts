import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ABSOLUTE_TTL_MS,
  IDLE_TTL_MS,
  createSession,
  hashSessionToken,
  isFeatureEnabled,
  lookupSession,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  setFeatureFlag,
} from '../src/auth/sessions.js';
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
const plus = (ms: number) => new Date(T0.getTime() + ms);

describe('sessions', () => {
  it('stores only a hash of the token', async () => {
    const u = await mkUser(c);
    const s = await createSession(c, { userId: u.id, client: 'web', now: T0 });
    expect(s.token).toMatch(/^hl_s_[A-Za-z0-9_-]{43}$/);
    const rows = await c.query('SELECT id_hash FROM sessions WHERE user_id = $1', [u.id]);
    expect(rows.rows[0].id_hash).toBe(hashSessionToken(s.token));
    expect(rows.rows[0].id_hash).not.toContain(s.token);
  });

  it('android sessions use the hl_at_ prefix and the same table', async () => {
    const u = await mkUser(c);
    const s = await createSession(c, { userId: u.id, client: 'android', now: T0 });
    expect(s.token.startsWith('hl_at_')).toBe(true);
    expect((await lookupSession(c, s.token, T0))?.client).toBe('android');
  });

  it('looks up a live session and slides the idle expiry', async () => {
    const u = await mkUser(c);
    const s = await createSession(c, { userId: u.id, client: 'web', now: T0 });
    const found = await lookupSession(c, s.token, plus(IDLE_TTL_MS / 2));
    expect(found?.userId).toBe(u.id);
    // Still valid past the original idle deadline because the last lookup extended it.
    expect(await lookupSession(c, s.token, plus(IDLE_TTL_MS + 1000))).not.toBeNull();
  });

  it('never slides past the absolute expiry', async () => {
    const u = await mkUser(c);
    const s = await createSession(c, { userId: u.id, client: 'web', now: T0 });
    let t = 0;
    while (t + IDLE_TTL_MS / 2 < ABSOLUTE_TTL_MS) {
      t += IDLE_TTL_MS / 2;
      expect(await lookupSession(c, s.token, plus(t))).not.toBeNull();
    }
    expect(await lookupSession(c, s.token, plus(ABSOLUTE_TTL_MS + 1000))).toBeNull();
  });

  it('refuses an idle-expired session', async () => {
    const u = await mkUser(c);
    const s = await createSession(c, { userId: u.id, client: 'web', now: T0 });
    expect(await lookupSession(c, s.token, plus(IDLE_TTL_MS + 1000))).toBeNull();
  });

  it('refuses unknown and malformed tokens', async () => {
    expect(await lookupSession(c, 'hl_s_nope', T0)).toBeNull();
    expect(await lookupSession(c, '', T0)).toBeNull();
  });

  it('revoke is server-side: the same token stops working', async () => {
    const u = await mkUser(c);
    const s = await createSession(c, { userId: u.id, client: 'web', now: T0 });
    expect(await revokeSession(c, s.token, T0)).toBe(true);
    expect(await lookupSession(c, s.token, T0)).toBeNull();
    expect(await revokeSession(c, s.token, T0)).toBe(false);
  });

  it('rotation revokes the old token and issues a new one', async () => {
    const u = await mkUser(c);
    const old = await createSession(c, { userId: u.id, client: 'web', now: T0 });
    const fresh = await rotateSession(c, old.token, { userId: u.id, client: 'web', now: T0 });
    expect(fresh.token).not.toBe(old.token);
    expect(await lookupSession(c, old.token, T0)).toBeNull();
    expect(await lookupSession(c, fresh.token, T0)).not.toBeNull();
  });

  it('rotation with no previous token just creates a session', async () => {
    const u = await mkUser(c);
    const fresh = await rotateSession(c, null, { userId: u.id, client: 'web', now: T0 });
    expect(await lookupSession(c, fresh.token, T0)).not.toBeNull();
  });

  it('revokeAll ends every session of one user and leaves others alone', async () => {
    const a = await mkUser(c);
    const b = await mkUser(c);
    const a1 = await createSession(c, { userId: a.id, client: 'web', now: T0 });
    const a2 = await createSession(c, { userId: a.id, client: 'android', now: T0 });
    const b1 = await createSession(c, { userId: b.id, client: 'web', now: T0 });
    expect(await revokeAllSessions(c, a.id, T0)).toBe(2);
    expect(await lookupSession(c, a1.token, T0)).toBeNull();
    expect(await lookupSession(c, a2.token, T0)).toBeNull();
    expect(await lookupSession(c, b1.token, T0)).not.toBeNull();
  });
});

describe('feature flag helpers', () => {
  it('is off by default and can be switched on and off again', async () => {
    expect(await isFeatureEnabled(c, 'accounts')).toBe(false);
    await setFeatureFlag(c, 'accounts', true);
    expect(await isFeatureEnabled(c, 'accounts')).toBe(true);
    await setFeatureFlag(c, 'accounts', true);
    await setFeatureFlag(c, 'accounts', false);
    expect(await isFeatureEnabled(c, 'accounts')).toBe(false);
  });
});
