import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import type { Client, PoolClient } from 'pg';
import * as schema from './schema/index.js';

type Queryable = Client | PoolClient;

function drizzleTables(): PgTable[] {
  const all: unknown[] = Object.values(schema);
  return all.filter((v): v is PgTable => is(v, PgTable));
}

/** Compare Drizzle table definitions against information_schema. Returns human-readable drift. */
export async function findSchemaDrift(client: Queryable): Promise<string[]> {
  const drift: string[] = [];
  for (const table of drizzleTables()) {
    const cfg = getTableConfig(table);
    const { rows } = await client.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`,
      [cfg.name],
    );
    if (rows.length === 0) {
      drift.push(`table ${cfg.name}: missing in database`);
      continue;
    }
    const dbCols = new Map(rows.map((r) => [r.column_name, r.is_nullable === 'YES']));
    for (const col of cfg.columns) {
      const nullable = dbCols.get(col.name);
      if (nullable === undefined) {
        drift.push(`column ${cfg.name}.${col.name}: missing in database`);
      } else if (nullable === col.notNull) {
        drift.push(
          `column ${cfg.name}.${col.name}: nullability differs (database ${nullable ? 'NULL' : 'NOT NULL'}, Drizzle ${col.notNull ? 'NOT NULL' : 'NULL'})`,
        );
      }
      dbCols.delete(col.name);
    }
    for (const extra of dbCols.keys()) {
      drift.push(`column ${cfg.name}.${extra}: in database but not in Drizzle schema`);
    }
  }
  return drift;
}
