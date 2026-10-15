import { Client } from 'pg';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../../.env.local'), quiet: true });

export const TEST_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://hirelane:hirelane@localhost:5433/hirelane_test';

/** A connected client against hirelane_test with an empty public schema. */
export async function freshTestClient(): Promise<Client> {
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(TEST_URL)) {
    throw new Error('Refusing to run DB tests against a non-local database');
  }
  const client = new Client({ connectionString: TEST_URL });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
  return client;
}
