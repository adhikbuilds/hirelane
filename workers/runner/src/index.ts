/** graphile-worker bootstrap. `pnpm worker` */
import './tz.js'; // must stay first: pins TZ=UTC before anything reads the clock
import { resolve } from 'node:path';
import { run, parseCrontab, Logger } from 'graphile-worker';
import { readFileSync } from 'node:fs';
import { requireDatabaseUrl } from '@hirelane/db/env';
import { taskList } from './tasks/index.js';
import { redactingLogFactory } from './logger.js';

const connectionString = requireDatabaseUrl();
const crontab = readFileSync(resolve(import.meta.dirname, '../crontab'), 'utf8');

const runner = await run({
  connectionString,
  concurrency: 4,
  noHandleSignals: false,
  pollInterval: 2000,
  taskList,
  logger: new Logger(redactingLogFactory),
  parsedCronItems: parseCrontab(crontab),
});

console.log('worker started; tasks:', Object.keys(taskList).join(', '));
await runner.promise;
