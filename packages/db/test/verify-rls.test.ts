import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { RLS_TABLES, verifyRls, type RlsTableSpec } from '../src/verify-rls-lib.js';
import { freshTestClient, TEST_URL } from './helpers.js';

const DIR = resolve(import.meta.dirname, '../migrations');
let admin: Client;

beforeAll(async () => {
  admin = await freshTestClient();
  await applyMigrations(admin, DIR);
});
afterAll(async () => {
  await admin.end();
});

const run = (extra: Partial<Parameters<typeof verifyRls>[1]> = {}) => verifyRls(admin, { url: TEST_URL, ...extra });

describe('verifyRls fixture', () => {
  it('passes on a correctly configured fixture and runs a meaningful number of checks', async () => {
    const r = await run();
    expect(r.failures).toEqual([]);
    expect(r.checks).toBeGreaterThan(25);
  });

  it('leaves no role, schema or rows behind', async () => {
    await run();
    const roles = await admin.query("SELECT 1 FROM pg_roles WHERE rolname LIKE 'hl_rls_%'");
    const schemas = await admin.query("SELECT 1 FROM pg_namespace WHERE nspname LIKE 'hl_rls_%'");
    expect(roles.rowCount).toBe(0);
    expect(schemas.rowCount).toBe(0);
  });

  it('fails when row level security is not enabled on an owned table', async () => {
    const r = await run({ fixtureFaults: ['no-rls'] });
    expect(r.failures.some((f) => /fx_own.*(read|update|delete)/.test(f))).toBe(true);
  });

  it('fails when the policy has an unchecked INSERT side', async () => {
    const r = await run({ fixtureFaults: ['open-insert'] });
    expect(r.failures.some((f) => /fx_own.*insert/.test(f))).toBe(true);
  });

  it('fails when a table that must be revoked stays readable', async () => {
    const r = await run({ fixtureFaults: ['grant-revoked'] });
    expect(r.failures.some((f) => /fx_rev/.test(f))).toBe(true);
  });

  it('fails when an insert-only table allows update', async () => {
    const r = await run({ fixtureFaults: ['grant-update'] });
    expect(r.failures.some((f) => /fx_ins.*update/.test(f))).toBe(true);
  });

  it('fails when an own-nd table (no hard delete) allows delete', async () => {
    const r = await run({ fixtureFaults: ['grant-delete'] });
    expect(r.failures.some((f) => /fx_nd.*delete/.test(f))).toBe(true);
  });

  it('registers the 0010 tables and passes their checks', async () => {
    const r = await run({ fixture: false });
    expect(r.failures).toEqual([]);
    for (const t of ['profiles', 'work_authorizations', 'answer_bank', 'resumes', 'file_access_log', 'eligibility_profiles']) {
      expect(RLS_TABLES.some((s) => s.name === t), t).toBe(true);
    }
  });

  it('refuses a non-local database', async () => {
    await expect(verifyRls(admin, { url: 'postgres://u:p@db.example.com:5432/x' })).rejects.toThrow(/local/);
  });
});

describe('migration 0007 posture', () => {
  it('makes the owner a member of hirelane_app and leaves the app role owning nothing', async () => {
    const m = await admin.query(
      "SELECT 1 FROM pg_auth_members WHERE roleid = 'hirelane_app'::regrole AND member = (SELECT oid FROM pg_roles WHERE rolname = current_user)",
    );
    expect(m.rowCount).toBe(1);
    const o = await admin.query("SELECT count(*)::int AS n FROM pg_class WHERE relowner = 'hirelane_app'::regrole");
    expect(o.rows[0].n).toBe(0);
    const c = await admin.query("SELECT has_schema_privilege('hirelane_app','public','CREATE') AS c");
    expect(c.rows[0].c).toBe(false);
  });
});

describe('verifyRls role posture and registry', () => {
  it('fails when the app role owns an object', async () => {
    await admin.query('CREATE TABLE app_owned (id int)');
    await admin.query('ALTER TABLE app_owned OWNER TO hirelane_app');
    try {
      const r = await run();
      expect(r.failures.some((f) => /hirelane_app owns/.test(f))).toBe(true);
    } finally {
      await admin.query('DROP TABLE app_owned');
    }
  });

  it('fails for an RLS table missing from the registry and for a user_id table without RLS', async () => {
    await admin.query('CREATE TABLE t_rls (id int, user_id uuid)');
    await admin.query('ALTER TABLE t_rls ENABLE ROW LEVEL SECURITY');
    await admin.query('CREATE TABLE t_bare (id int, user_id uuid)');
    await admin.query('GRANT SELECT ON t_bare TO hirelane_app');
    try {
      const r = await run();
      expect(r.failures.some((f) => /t_rls.*not in the RLS registry/.test(f))).toBe(true);
      expect(r.failures.some((f) => /t_bare.*user_id.*without row level security/.test(f))).toBe(true);
    } finally {
      await admin.query('DROP TABLE t_rls, t_bare');
    }
  });

  it('verifies registered real tables of every mode', async () => {
    await admin.query(`
      CREATE TABLE reg_own (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, v text);
      ALTER TABLE reg_own ENABLE ROW LEVEL SECURITY;
      CREATE POLICY p ON reg_own FOR ALL TO hirelane_app
        USING (user_id = current_setting('hirelane.user_id')::uuid) WITH CHECK (user_id = current_setting('hirelane.user_id')::uuid);
      GRANT SELECT, INSERT, UPDATE, DELETE ON reg_own TO hirelane_app;
      CREATE TABLE reg_rev (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
      REVOKE ALL ON reg_rev FROM hirelane_app;
    `);
    const seed = (table: string) => async (c: Client, userId: string) => {
      await c.query(`INSERT INTO ${table} (user_id) VALUES ($1)`, [userId]);
    };
    const cleanup = (table: string) => async (c: Client, ids: string[]) => {
      await c.query(`DELETE FROM ${table} WHERE user_id = ANY($1::uuid[])`, [ids]);
    };
    const specs: RlsTableSpec[] = [
      { name: 'reg_own', table: 'public.reg_own', mode: 'own', userColumn: 'user_id', seed: seed('reg_own'), cleanup: cleanup('reg_own') },
      { name: 'reg_rev', table: 'public.reg_rev', mode: 'rev', userColumn: 'user_id', seed: seed('reg_rev'), cleanup: cleanup('reg_rev') },
    ];
    try {
      const r = await run({ tables: [...RLS_TABLES, ...specs] });
      expect(r.failures).toEqual([]);
      expect((await admin.query('SELECT 1 FROM reg_own')).rowCount).toBe(0);
      const missing = await run({ tables: [...RLS_TABLES, { ...specs[0]!, name: 'gone', table: 'public.gone' }] });
      expect(missing.failures.some((f) => /gone/.test(f))).toBe(true);
    } finally {
      await admin.query('DROP TABLE reg_own, reg_rev');
    }
  });

  it('ships an empty-by-default registry that later milestones extend', () => {
    expect(Array.isArray(RLS_TABLES)).toBe(true);
  });
});

describe('verifyRls on the 0008 auth tables', () => {
  it('registers all seven auth tables and passes', async () => {
    const names = RLS_TABLES.map((t) => t.name);
    for (const n of ['users', 'consents', 'product_events', 'idempotency_keys', 'sessions', 'otp_challenges', 'auth_identities']) {
      expect(names).toContain(n);
    }
    const r = await run({ fixture: false });
    expect(r.failures).toEqual([]);
    expect(r.checks).toBeGreaterThan(40);
  });

  it('fails when the app role can insert into users', async () => {
    await admin.query('GRANT INSERT ON users TO hirelane_app');
    await admin.query('CREATE POLICY users_fault_ins ON users FOR INSERT TO hirelane_app WITH CHECK (true)');
    try {
      const r = await run({ fixture: false });
      expect(r.failures.some((f) => /users.*insert/.test(f))).toBe(true);
    } finally {
      await admin.query('DROP POLICY users_fault_ins ON users');
      await admin.query('REVOKE INSERT ON users FROM hirelane_app');
    }
  });

  it('fails when sessions becomes readable by the app role', async () => {
    await admin.query('GRANT SELECT ON sessions TO hirelane_app');
    try {
      const r = await run({ fixture: false });
      expect(r.failures.some((f) => /sessions/.test(f))).toBe(true);
    } finally {
      await admin.query('REVOKE ALL ON sessions FROM hirelane_app');
    }
  });

  it('fails when a registered table loses row level security', async () => {
    await admin.query('ALTER TABLE consents DISABLE ROW LEVEL SECURITY');
    try {
      const r = await run({ fixture: false });
      expect(r.failures.some((f) => /consents/.test(f))).toBe(true);
    } finally {
      await admin.query('ALTER TABLE consents ENABLE ROW LEVEL SECURITY');
    }
  });

  it('leaves no synthetic users behind', async () => {
    await run({ fixture: false });
    const n = await admin.query("SELECT count(*)::int AS n FROM users WHERE email LIKE 'rls-%@example.test'");
    expect(n.rows[0].n).toBe(0);
  });
});
