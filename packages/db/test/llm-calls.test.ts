import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { findSchemaDrift } from '../src/verify-schema-lib.js';
import { freshTestClient } from './helpers.js';

describe('llm_calls', () => {
  let client: Client;
  beforeAll(async () => {
    client = await freshTestClient();
    await applyMigrations(client, resolve(import.meta.dirname, '../migrations'));
  });
  afterAll(async () => {
    await client.end();
  });

  it('matches the Drizzle definition', async () => {
    expect((await findSchemaDrift(client)).filter((d) => d.includes('llm_calls'))).toEqual([]);
  });

  it('has no column that could hold prompt or completion content', async () => {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'llm_calls'`,
    );
    const names = rows.map((r) => r.column_name as string);
    for (const banned of ['prompt', 'completion', 'content', 'response', 'input', 'output', 'text', 'message']) {
      expect(names).not.toContain(banned);
    }
  });

  it('rejects an unknown mode', async () => {
    await expect(
      client.query(`INSERT INTO llm_calls (purpose, model, mode, status) VALUES ('p','m','bogus','ok')`),
    ).rejects.toThrow();
  });
});
