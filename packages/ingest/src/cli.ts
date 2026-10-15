/** `pnpm ingest:run --mode fixture|live`. Ingests every verified board in boards.json once. */
import { close } from '@hirelane/db';
import { requireDatabaseUrl } from '@hirelane/db/env';
import { createHostLimiter } from './record/limiter';
import { parseArgs } from './run/args';
import { loadBoardConfig } from './run/boards';
import { createFixtureFetch } from './run/fixtures';
import { createPolicyFetch } from './run/policy';
import { defaultRetryPolicy } from './run/retry';
import { runIngest } from './run/run';

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`ingest:run mode=${args.mode}`);
  requireDatabaseUrl();

  const boards = loadBoardConfig();
  const fetchFn =
    args.mode === 'fixture'
      ? createFixtureFetch({ boards, inject: args.inject, ...(args.fixturesDir ? { dir: args.fixturesDir } : {}) })
      : createPolicyFetch({
          rawFetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
          limiter: createHostLimiter({ minIntervalMs: 1000 }),
        });

  const s = await runIngest({
    mode: args.mode,
    boards,
    fetch: fetchFn,
    retry: defaultRetryPolicy(args.mode),
    concurrency: args.concurrency ?? (args.mode === 'fixture' ? 8 : 6),
    onBoard: (o) => {
      if (o.status !== 'ok') console.warn(`  ${o.board.ats}:${o.board.token} ${o.status}: ${o.error ?? ''} (attempts ${o.attempts})`);
    },
  });

  console.log(`run ${s.runId} status=${s.status}`);
  console.log(`boards:   ${s.boards} (ok ${s.boardsOk}, failed ${s.boardsFailed})`);
  console.log(`postings: fetched ${s.fetched}, new ${s.new}, changed ${s.changed}, unchanged ${s.unchanged}, closed ${s.closed}`);
  console.log(`elapsed:  ${(s.elapsedMs / 1000).toFixed(1)} s`);
  return s.status === 'failed' ? 1 : 0;
}

main()
  .then(async (code) => {
    await close();
    process.exit(code);
  })
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await close();
    process.exit(1);
  });
