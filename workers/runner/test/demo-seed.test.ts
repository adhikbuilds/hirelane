/**
 * The demo seed against a throwaway Postgres database. Synthetic data only, 0 LLM calls, no network.
 * It must be refused outside an explicit local demo, idempotent, and leave a console that shows real (not hard-coded) figures.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '@hirelane/db';
import { TEST_URL } from '../../../packages/db/test/helpers';
import { assertDemoMayRun, DEMO_CAMPUS_NAME, seedDemo } from '../../../scripts/demo-seed-lib';
import { runCampusStats } from '../src/tasks/campus-stats';

const DBNAME = `hl_demo_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const url = new URL(TEST_URL);
let c: Client;
let admin: Client;

const deps = () => ({
  run: <T>(fn: (q: Client) => Promise<T>) => fn(c),
  mailboxHmac: async (e: string) => `mb-${e}`,
  codeHmac: async (code: string) => `code-${code}`,
  generateCode: () => 'DEMO2K7Q',
  now: () => new Date('2026-11-06T04:00:00Z'),
});

beforeAll(async () => {
  admin = new Client({ connectionString: TEST_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${DBNAME}`);
  url.pathname = `/${DBNAME}`;
  c = new Client({ connectionString: url.toString() });
  await c.connect();
  await applyMigrations(c, resolve(import.meta.dirname, '../../../packages/db/migrations'));
}, 60_000);
afterAll(async () => {
  await c?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${DBNAME}`).catch(() => undefined);
  await admin?.end();
});

describe('assertDemoMayRun', () => {
  it('needs HIRELANE_DEMO=1, a local database and a non-production NODE_ENV', () => {
    const ok = { HIRELANE_DEMO: '1', NODE_ENV: 'development' };
    expect(() => assertDemoMayRun('postgres://u@localhost:5432/x', ok)).not.toThrow();
    expect(() => assertDemoMayRun('postgres://u@localhost:5432/x', { NODE_ENV: 'development' })).toThrow(/HIRELANE_DEMO/);
    expect(() => assertDemoMayRun('postgres://u@db.prod.example.test:5432/x', ok)).toThrow(/local/);
    expect(() => assertDemoMayRun('postgres://u@localhost:5432/x', { ...ok, NODE_ENV: 'production' })).toThrow(/production/);
  });
});

describe('seedDemo', () => {
  it('builds one synthetic campus with 10+ verified students, drives, outcomes and an unclaimed owner seat; a second run changes nothing', async () => {
    const first = await seedDemo(deps());
    expect(first.created).toBe(true);
    const n = async (sql: string) => Number((await c.query(sql)).rows[0].n);
    const campus = `(SELECT id FROM campuses WHERE name = '${DEMO_CAMPUS_NAME}')`;
    expect(await n(`SELECT count(*)::int n FROM cohort_members WHERE campus_id = ${campus} AND verified_at IS NOT NULL`)).toBeGreaterThanOrEqual(20);
    expect(await n(`SELECT count(*)::int n FROM drives WHERE campus_id = ${campus}`)).toBeGreaterThanOrEqual(2);
    expect(await n(`SELECT count(*)::int n FROM outcomes WHERE campus_id = ${campus} AND kind = 'offer'`)).toBeGreaterThanOrEqual(3);
    expect(await n(`SELECT count(*)::int n FROM outcomes WHERE campus_id = ${campus} AND kind = 'higher_studies'`)).toBeGreaterThanOrEqual(1);
    expect(await n(`SELECT count(*)::int n FROM tpo_members WHERE campus_id = ${campus} AND role = 'owner' AND claimed_at IS NULL`)).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM users WHERE email::text NOT LIKE '%.example.test'`)).toBe(0); // synthetic addresses only
    const before = await n('SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM drives) + (SELECT count(*) FROM outcomes) AS n');
    expect((await seedDemo(deps())).created).toBe(false);
    expect(await n('SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM drives) + (SELECT count(*) FROM outcomes) AS n')).toBe(before);
  });

  it('after the nightly snapshot the cohort shows released counts (k >= 10), not nothing', async () => {
    await runCampusStats((fn) => fn(c as never), new Date('2026-11-06T04:00:00Z'));
    const r = await c.query(`SELECT n FROM cohort_stats_daily WHERE metric = 'joined_verified' AND day = '2026-11-06'`);
    expect(Number(r.rows[0].n)).toBeGreaterThanOrEqual(20);
  });
});
