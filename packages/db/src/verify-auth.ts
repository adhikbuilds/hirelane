/** pnpm db:verify-auth : fails when the account invariants (18+ gate, sessions, OTP, delete) do not hold. Local database only. */
import { Client } from 'pg';
import { requireDatabaseUrl } from './env.js';
import { verifyAuth } from './verify-auth-lib.js';

const url = requireDatabaseUrl();
const client = new Client({ connectionString: url });
client
  .connect()
  .then(() => verifyAuth(client, { url }))
  .then((r) => {
    if (r.failures.length > 0) {
      console.error('Auth verification failed:\n' + r.failures.map((f) => `  - ${f}`).join('\n'));
      process.exitCode = 1;
    } else {
      console.log(`Auth verification passed (${r.checks} checks).`);
    }
  })
  .catch((error: unknown) => {
    console.error(`verify-auth failed: ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => client.end());
