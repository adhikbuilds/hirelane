/**
 * `pnpm ops <command>`: the pilot operator commands (campus, domains, cgpa_rule, owner invite, platform switches).
 * See packages/db/src/ops/index.ts for the commands and the audit rule. Run as the owner role against DATABASE_URL.
 */
import { close, withAdmin } from '../../packages/db/src/index';
import { requireDatabaseUrl } from '../../packages/db/src/env';
import { runOpsCli } from '../../packages/db/src/ops/index';
import { assertMayRun, buildOpsDeps } from './deps';

async function main(): Promise<number> {
  const url = requireDatabaseUrl();
  const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
  const help = argv.length === 0 || argv[0] === '--help' || argv[0] === '-h';
  if (!help) assertMayRun(url, process.env);
  const deps = buildOpsDeps({ env: process.env, run: (fn) => withAdmin((c) => fn(c)), log: (l) => console.log(l) });
  try {
    return await runOpsCli(argv, deps);
  } finally {
    await close();
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`error: ${e instanceof Error ? e.message : 'unexpected failure'}`);
    process.exit(1);
  },
);
