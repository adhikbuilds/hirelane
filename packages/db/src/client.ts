import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { isLocalUrl, requireDatabaseUrl } from './env.js';
import * as schema from './schema/index.js';

let pool: Pool | undefined;

/** One lazily created pool per process, so importing this module never needs DATABASE_URL. */
export function getPool(): Pool {
  if (!pool) {
    const url = requireDatabaseUrl();
    pool = new Pool({
      connectionString: url,
      // TLS for anything that is not this machine, whether or not the URL asks for it.
      ssl: isLocalUrl(url) ? undefined : { rejectUnauthorized: true },
      max: 10,
    });
  }
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

/** Admin work (migrations, ingest, seeding, ops). Runs as the owner and bypasses RLS. */
export async function withAdmin<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Run work in a transaction as the unprivileged `hirelane_app` role with the user context set.
 *
 * `SET LOCAL` scopes both settings to this transaction, so a pooled connection cannot leak one
 * user's context into the next request. Without the role switch, queries run as the owner (a
 * superuser locally) and RLS policies would look like they work while never being exercised.
 */
export async function withUser<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE hirelane_app');
    await client.query("SELECT set_config('hirelane.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function close(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}
