import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Client, PoolClient } from 'pg';

export interface MigrationResult {
  applied: string[];
  unchanged: string[];
}

type Queryable = Client | PoolClient;

/**
 * Numbered SQL migrations, applied in order and recorded with a checksum.
 * An applied migration whose file has since changed is refused: add a new migration instead.
 */
export async function applyMigrations(
  client: Queryable,
  dir: string,
  log: (line: string) => void = () => {},
): Promise<MigrationResult> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(resolve(dir))).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await client.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations',
  );
  const recorded = new Map(rows.map((r) => [r.name, r.checksum]));
  const result: MigrationResult = { applied: [], unchanged: [] };

  for (const file of files) {
    const sql = await readFile(resolve(dir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex').slice(0, 16);
    const previous = recorded.get(file);

    if (previous === checksum) {
      log(`  = ${file}`);
      result.unchanged.push(file);
      continue;
    }
    if (previous !== undefined) {
      throw new Error(
        `${file} has changed since it was applied (${previous} -> ${checksum}). ` +
          `Add a new migration instead of editing this one, or run \`pnpm db:reset\` locally.`,
      );
    }

    log(`  + ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        file,
        checksum,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`${file} failed: ${(error as Error).message}`, { cause: error });
    }
    result.applied.push(file);
  }
  return result;
}
