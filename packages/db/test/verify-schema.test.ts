import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { findSchemaDrift } from '../src/verify-schema-lib.js';
import { freshTestClient } from './helpers.js';

describe('schema drift check', () => {
  let client: Client;
  beforeAll(async () => {
    client = await freshTestClient();
    await applyMigrations(client, resolve(import.meta.dirname, '../migrations'));
  });
  afterAll(async () => {
    await client.end();
  });

  it('reports no drift on a freshly migrated database', async () => {
    expect(await findSchemaDrift(client)).toEqual([]);
  });

  it('catches a column that is missing from the database', async () => {
    await client.query('ALTER TABLE rate_limits DROP COLUMN count');
    const drift = await findSchemaDrift(client);
    expect(drift).toContainEqual(expect.stringMatching(/rate_limits\.count.*missing in database/));
  });

  it('catches a column the Drizzle schema does not know about', async () => {
    await client.query('ALTER TABLE rate_limits ADD COLUMN count int NOT NULL DEFAULT 0');
    await client.query('ALTER TABLE worker_heartbeats ADD COLUMN stray text');
    const drift = await findSchemaDrift(client);
    expect(drift).toContainEqual(expect.stringMatching(/worker_heartbeats\.stray.*not in Drizzle/));
  });

  it('catches a missing table', async () => {
    await client.query('DROP TABLE feature_flags');
    expect(await findSchemaDrift(client)).toContainEqual(
      expect.stringMatching(/feature_flags.*missing in database/),
    );
  });
});
