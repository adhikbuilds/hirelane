/** housekeeping:sweep against real Postgres (throwaway database). Synthetic data only. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCrontab } from 'graphile-worker';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '@hirelane/db';
import { TEST_URL } from '../../../packages/db/test/helpers';
import { mkUser } from '../../../packages/db/test/auth-helpers';
import { runHousekeeping } from '../src/tasks/housekeeping';
import { taskList } from '../src/tasks/index';
import type { Run } from '../src/tasks/resume-common';

const DBNAME = `hl_runner_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const url = new URL(TEST_URL);
let c: Client;
let admin: Client;
let run: Run;
const NOW = new Date('2026-10-31T12:00:00Z');

beforeAll(async () => {
  admin = new Client({ connectionString: TEST_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${DBNAME}`);
  url.pathname = `/${DBNAME}`;
  c = new Client({ connectionString: url.toString() });
  await c.connect();
  await applyMigrations(c, resolve(import.meta.dirname, '../../../packages/db/migrations'));
  run = (fn) => fn(c as never);
}, 60_000);
afterAll(async () => {
  await c?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${DBNAME}`).catch(() => undefined);
  await admin?.end();
});

describe('housekeeping:sweep', () => {
  it('deletes dead otp challenges, old rate-limit windows and old join attempts, and keeps live ones', async () => {
    const u = await mkUser(c);
    await c.query(
      `INSERT INTO otp_challenges (channel, target_hmac, code_hash, expires_at) VALUES ('email', 'old', 'x', $1), ('email', 'live', 'x', $2)`,
      [new Date(NOW.getTime() - 3 * 86_400_000), new Date(NOW.getTime() + 600_000)],
    );
    await c.query(`INSERT INTO rate_limits (bucket, window_start, count) VALUES ('old', $1, 1), ('new', $2, 1)`, [new Date(NOW.getTime() - 3 * 86_400_000), new Date(NOW.getTime() - 60_000)]);
    await c.query(`INSERT INTO join_attempts (user_id, kind, at) VALUES ($1, 'code', $2), ($1, 'code', $3)`, [u.id, new Date(NOW.getTime() - 40 * 86_400_000), new Date(NOW.getTime() - 86_400_000)]);
    const r = await runHousekeeping(run, NOW);
    expect(r).toEqual({ otp: 1, rateLimits: 1, joinAttempts: 1 });
    expect((await c.query('SELECT target_hmac FROM otp_challenges')).rows.map((x) => x.target_hmac)).toEqual(['live']);
    expect((await c.query('SELECT bucket FROM rate_limits')).rows.map((x) => x.bucket)).toEqual(['new']);
    expect((await c.query('SELECT count(*)::int AS n FROM join_attempts')).rows[0].n).toBe(1);
    expect(await runHousekeeping(run, NOW)).toEqual({ otp: 0, rateLimits: 0, joinAttempts: 0 });
  });

  it('is registered and on the crontab, together with inbound:scan', () => {
    expect(taskList['housekeeping:sweep']).toBeTypeOf('function');
    const tasks = parseCrontab(readFileSync(resolve(import.meta.dirname, '../crontab'), 'utf8')).map((i) => i.task);
    expect(tasks).toContain('housekeeping:sweep');
    expect(tasks).toContain('inbound:scan');
  });
});
