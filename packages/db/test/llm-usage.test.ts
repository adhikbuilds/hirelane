import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { findSchemaDrift } from '../src/verify-schema-lib.js';
import { mkUser } from './auth-helpers.js';
import { freshTestClient } from './helpers.js';

describe('0019 llm usage', () => {
  let client: Client;
  beforeAll(async () => {
    client = await freshTestClient();
    await applyMigrations(client, resolve(import.meta.dirname, '../migrations'));
  });
  afterAll(async () => {
    await client.end();
  });

  it('matches the Drizzle definitions', async () => {
    const drift = await findSchemaDrift(client);
    expect(drift.filter((d) => d.includes('llm_'))).toEqual([]);
  });

  it('llm_calls gains cost and user columns but still no content column', async () => {
    const { rows } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'llm_calls'`);
    const names = rows.map((r) => r.column_name as string);
    expect(names).toEqual(expect.arrayContaining(['est_cost_usd', 'user_id']));
    for (const banned of ['prompt', 'completion', 'content', 'response', 'text', 'message']) expect(names).not.toContain(banned);
  });

  it('counts per student per day and rejects negatives', async () => {
    const { id } = await mkUser(client);
    const up = `INSERT INTO llm_user_daily (user_id, day, calls) VALUES ($1, '2026-11-09', 1)
                ON CONFLICT (user_id, day) DO UPDATE SET calls = llm_user_daily.calls + 1 RETURNING calls`;
    expect((await client.query(up, [id])).rows[0].calls).toBe(1);
    expect((await client.query(up, [id])).rows[0].calls).toBe(2);
    await expect(client.query(`INSERT INTO llm_user_daily (user_id, day, calls) VALUES ($1, '2026-11-10', -1)`, [id])).rejects.toThrow();
  });

  it('is not reachable by the app role', async () => {
    const { rows } = await client.query(
      `SELECT has_table_privilege('hirelane_app', 'llm_user_daily', 'SELECT') AS s`,
    );
    expect(rows[0]).toEqual({ s: false });
  });
});
