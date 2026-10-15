/** graphile-worker bootstrap. `pnpm worker` */
import { resolve } from 'node:path';
import { run, parseCrontab } from 'graphile-worker';
import { readFileSync } from 'node:fs';
import { requireDatabaseUrl } from '@hirelane/db/env';
import { taskList } from './tasks/index.js';

const connectionString = requireDatabaseUrl();
const crontab = readFileSync(resolve(import.meta.dirname, '../crontab'), 'utf8');

const runner = await run({
  connectionString,
  concurrency: 4,
  noHandleSignals: false,
  pollInterval: 2000,
  taskList,
  parsedCronItems: parseCrontab(crontab),
});

console.log('worker started; tasks:', Object.keys(taskList).join(', '));
await runner.promise;
