/** Drop and recreate the public schema plus the queue schema. Local development only. */
import { close, withAdmin } from './client.js';
import { isLocalUrl, requireDatabaseUrl } from './env.js';

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  if (!isLocalUrl(url)) {
    throw new Error(
      `Refusing to reset a non-local database (${url.replace(/\/\/[^@]*@/, '//***:***@')}).`,
    );
  }
  await withAdmin(async (client) => {
    await client.query('DROP SCHEMA IF EXISTS graphile_worker CASCADE');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log('Schema dropped and recreated. Run `pnpm db:migrate` next.');
  });
}

main()
  .catch((error: unknown) => {
    console.error(`\n${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(close);
