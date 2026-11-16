import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { mkUser } from './auth-helpers.js';
import { freshTestClient } from './helpers.js';

/** 0016 review fixes. Synthetic data only. */
let c: Client;
beforeAll(async () => {
  c = await freshTestClient();
  await applyMigrations(c, resolve(import.meta.dirname, '../migrations'));
});
afterAll(async () => {
  await c.end();
});

async function asRole<T>(role: string, userId: string, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    await c.query(`SET LOCAL ROLE ${role}`);
    await c.query("SELECT set_config('hirelane.user_id', $1, true)", [userId]);
    const out = await fn();
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }
}
const code = async (p: Promise<unknown>): Promise<string | undefined> => p.then(() => undefined, (e) => (e as { code?: string }).code);

async function mkResume(userId: string, over: { status?: string } = {}): Promise<string> {
  const id = randomUUID();
  await c.query(
    `INSERT INTO resumes (id, user_id, source, mime, size_bytes, file_hmac, blob_key, parse_status, confirmed_at)
     VALUES ($1, $2, 'upload', 'application/pdf', 10, $3, $4, $5, CASE WHEN $5 = 'confirmed' THEN now() END)`,
    [id, userId, `h-${id}`, `resumes/${userId}/${id}`, over.status ?? 'parsed'],
  );
  return id;
}

describe('resumes: the app role cannot undo worker-only invariants', () => {
  it('cannot un-delete, push out the purge, or change parse_status/confirmed_at', async () => {
    const u = await mkUser(c);
    const id = await mkResume(u.id);
    await asRole('hirelane_app', u.id, () => c.query('UPDATE resumes SET deleted_at = now(), purge_after = now() WHERE id = $1', [id]));
    expect(await code(asRole('hirelane_app', u.id, () => c.query('UPDATE resumes SET deleted_at = NULL WHERE id = $1', [id])))).toBe('23514');
    expect(await code(asRole('hirelane_app', u.id, () => c.query("UPDATE resumes SET purge_after = now() + interval '30 days' WHERE id = $1", [id])))).toBe('23514');
    const live = await mkResume(u.id);
    expect(await code(asRole('hirelane_app', u.id, () => c.query("UPDATE resumes SET parse_status = 'confirmed', confirmed_at = now() WHERE id = $1", [live])))).toBe('23514');
    expect(await code(asRole('hirelane_app', u.id, () => c.query("UPDATE resumes SET deleted_at = now(), purge_after = now() + interval '9 days' WHERE id = $1", [live])))).toBe('23514');
  });
  it('can still soft-delete, relabel and re-seal', async () => {
    const u = await mkUser(c);
    const id = await mkResume(u.id);
    await asRole('hirelane_app', u.id, () => c.query("UPDATE resumes SET label = 'x', parsed_version = parsed_version + 1 WHERE id = $1", [id]));
    await asRole('hirelane_app', u.id, () => c.query('UPDATE resumes SET deleted_at = now(), purge_after = now(), is_default = false WHERE id = $1', [id]));
  });
  it('the owner role (worker) is unaffected', async () => {
    const u = await mkUser(c);
    const id = await mkResume(u.id);
    await c.query("UPDATE resumes SET parse_status = 'confirmed', confirmed_at = now() WHERE id = $1", [id]);
  });
});

describe('erase_waitlist', () => {
  it('removes the erased account\'s waitlist row by lower(email), for the auth role only', async () => {
    const u = await mkUser(c);
    await c.query("INSERT INTO waitlist (email, consent_at) VALUES ($1, now()), ('keep@example.test', now())", [u.email.toUpperCase()]);
    await asRole('hirelane_auth', u.id, () => c.query('SELECT erase_waitlist($1)', [u.id]));
    expect((await c.query('SELECT email FROM waitlist WHERE lower(email) IN (lower($1), $2)', [u.email, 'keep@example.test'])).rows.map((r) => r.email)).toEqual(['keep@example.test']);
    expect(await code(asRole('hirelane_app', u.id, () => c.query('SELECT erase_waitlist($1)', [u.id])))).toBe('42501');
  });
});
