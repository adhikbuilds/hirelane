import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { freshTestClient } from './helpers.js';

const REAL_DIR = resolve(import.meta.dirname, '../migrations');

describe('migrator', () => {
  let client: Client;
  let dir: string;

  beforeAll(async () => {
    client = await freshTestClient();
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    dir = await mkdtemp(join(tmpdir(), 'hl-mig-'));
    return async () => rm(dir, { recursive: true, force: true });
  });

  it('applies new migrations once and is idempotent on re-run', async () => {
    await writeFile(join(dir, '0001_a.sql'), 'CREATE TABLE a (id int);');
    const first = await applyMigrations(client, dir);
    expect(first.applied).toEqual(['0001_a.sql']);
    const second = await applyMigrations(client, dir);
    expect(second.applied).toEqual([]);
    expect(second.unchanged).toEqual(['0001_a.sql']);
  });

  it('refuses a migration edited after it was applied', async () => {
    const file = join(dir, '0001_a.sql');
    await writeFile(file, 'CREATE TABLE a (id int);');
    await applyMigrations(client, dir);
    await writeFile(file, 'CREATE TABLE a (id int, extra text);');
    await expect(applyMigrations(client, dir)).rejects.toThrow(/0001_a\.sql has changed/);
  });

  it('rolls back a failing migration and does not record it', async () => {
    await writeFile(join(dir, '0001_bad.sql'), 'CREATE TABLE ok (id int); SELECT nope();');
    await expect(applyMigrations(client, dir)).rejects.toThrow(/0001_bad\.sql failed/);
    const { rows } = await client.query("SELECT to_regclass('public.ok') AS t");
    expect(rows[0].t).toBeNull();
    const rec = await client.query('SELECT 1 FROM schema_migrations');
    expect(rec.rowCount).toBe(0);
  });

  it('real foundation migration creates extensions, role and tables', async () => {
    await applyMigrations(client, REAL_DIR);
    const ext = await client.query<{ extname: string }>('SELECT extname FROM pg_extension');
    const names = ext.rows.map((r) => r.extname);
    for (const e of ['vector', 'pg_trgm', 'citext', 'pgcrypto']) expect(names).toContain(e);
    const role = await client.query<{ rolcanlogin: boolean }>(
      "SELECT rolcanlogin FROM pg_roles WHERE rolname = 'hirelane_app'",
    );
    expect(role.rows[0]?.rolcanlogin).toBe(false);
    for (const t of ['worker_heartbeats', 'feature_flags', 'rate_limits']) {
      const r = await client.query('SELECT to_regclass($1) AS t', [`public.${t}`]);
      expect(r.rows[0].t).not.toBeNull();
    }
  });
});
