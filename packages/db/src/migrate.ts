/** pnpm --filter @hirelane/db migrate */
import { resolve } from 'node:path';
import { close, withAdmin } from './client.js';
import { applyMigrations } from './migrator.js';

const DIR = resolve(import.meta.dirname, '../migrations');

withAdmin((client) => applyMigrations(client, DIR, console.log))
  .then((r) => console.log(`\nSchema up to date (${r.applied.length} applied, ${r.unchanged.length} unchanged).`))
  .catch((error: unknown) => {
    console.error(`\nMigration failed: ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(close);
