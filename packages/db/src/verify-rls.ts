/** pnpm db:verify-rls : fails when row level security does not isolate users. Local database only. */
import { Client } from 'pg';
import { requireDatabaseUrl } from './env.js';
import { verifyRls } from './verify-rls-lib.js';

const url = requireDatabaseUrl();
const client = new Client({ connectionString: url });
client
  .connect()
  .then(() => verifyRls(client, { url }))
  .then((r) => {
    if (r.failures.length > 0) {
      console.error('RLS verification failed:\n' + r.failures.map((f) => `  - ${f}`).join('\n'));
      process.exitCode = 1;
    } else {
      console.log(`RLS verification passed (${r.checks} checks).`);
    }
  })
  .catch((error: unknown) => {
    console.error(`verify-rls failed: ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
