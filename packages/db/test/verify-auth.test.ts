import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { verifyAuth } from '../src/verify-auth-lib.js';
import { freshTestClient, TEST_URL } from './helpers.js';

let admin: Client;
beforeAll(async () => {
  admin = await freshTestClient();
  await applyMigrations(admin, resolve(import.meta.dirname, '../migrations'));
});
afterAll(async () => {
  await admin.end();
});
const run = () => verifyAuth(admin, { url: TEST_URL });

describe('verifyAuth', () => {
  it('passes on a correct schema with at least 15 checks', async () => {
    const r = await run();
    expect(r.failures).toEqual([]);
    expect(r.checks).toBeGreaterThanOrEqual(15);
  });

  it('leaves nothing behind', async () => {
    await run();
    expect((await admin.query("SELECT 1 FROM users WHERE email LIKE 'verify-auth-%'")).rowCount).toBe(0);
    expect((await admin.query("SELECT 1 FROM otp_challenges WHERE target_hmac LIKE 'verify-auth-%'")).rowCount).toBe(0);
  });

  it('fails when the age-consent trigger is missing', async () => {
    await admin.query('ALTER TABLE users DISABLE TRIGGER users_age_consent');
    try {
      const r = await run();
      expect(r.failures.some((f) => /age_18_plus/.test(f))).toBe(true);
    } finally {
      await admin.query('ALTER TABLE users ENABLE TRIGGER users_age_consent');
    }
  });

  it('fails when the app role can read sessions', async () => {
    await admin.query('GRANT SELECT ON sessions TO hirelane_app');
    try {
      const r = await run();
      expect(r.failures.some((f) => /sessions.*app role/.test(f))).toBe(true);
    } finally {
      await admin.query('REVOKE ALL ON sessions FROM hirelane_app');
    }
  });

  it('fails when the app role can edit consents', async () => {
    await admin.query('GRANT UPDATE ON consents TO hirelane_app');
    await admin.query('CREATE POLICY consents_fault_upd ON consents FOR UPDATE TO hirelane_app USING (true)');
    try {
      const r = await run();
      expect(r.failures.some((f) => /consents.*append-only/.test(f))).toBe(true);
    } finally {
      await admin.query('DROP POLICY consents_fault_upd ON consents');
      await admin.query('REVOKE UPDATE ON consents FROM hirelane_app');
    }
  });

  it('refuses a non-local database', async () => {
    await expect(verifyAuth(admin, { url: 'postgres://u:p@db.example.com:5432/x' })).rejects.toThrow(/local/);
  });
});
