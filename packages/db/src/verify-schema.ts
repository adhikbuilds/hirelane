/** pnpm db:verify-schema : fails when Drizzle definitions and the migrated database disagree. */
import { close, withAdmin } from './client.js';
import { findSchemaDrift } from './verify-schema-lib.js';

withAdmin(findSchemaDrift)
  .then((drift) => {
    if (drift.length > 0) {
      console.error('Schema drift detected:\n' + drift.map((d) => `  - ${d}`).join('\n'));
      process.exitCode = 1;
    } else {
      console.log('Schema matches the Drizzle definitions.');
    }
  })
  .catch((error: unknown) => {
    console.error(`verify-schema failed: ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(close);
