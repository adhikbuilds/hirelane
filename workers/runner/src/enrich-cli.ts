/**
 * Runs enrichment in-process (no graphile queue): `pnpm enrich:run [--concurrency=4] [--company=<uuid>] [--version=<n>]`.
 * Same code path as the enrich:company task. Never calls an LLM.
 */
import { close, getPool, listPendingCompanies } from '@hirelane/db';
import { ENRICH_VERSION } from '@hirelane/engine';
import { enrichCompany, ensureReferenceData, loadEngineFx, syncJobLifecycle, type EnrichStats } from './tasks/enrich-core.js';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const concurrency = Math.max(1, Number(arg('concurrency') ?? 4));
  const version = Number(arg('version') ?? ENRICH_VERSION);
  const only = arg('company');
  const pool = getPool();
  const boot = await pool.connect();
  let fx;
  try {
    await ensureReferenceData(boot);
    fx = await loadEngineFx(boot);
  } finally {
    boot.release();
  }
  const check = await pool.connect();
  let todo: { companyId: string; pending: number }[];
  try {
    todo = (await listPendingCompanies(check, version)).filter((c) => !only || c.companyId === only);
  } finally {
    check.release();
  }
  const total = todo.reduce((n, c) => n + c.pending, 0);
  console.log(`enrich:run version=${version} companies=${todo.length} pending=${total} concurrency=${concurrency}`);

  const sum: EnrichStats = { seen: 0, enriched: 0, created: 0, attached: 0, errors: 0, errorSamples: [] };
  let doneCompanies = 0;
  const started = Date.now();
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const client = await pool.connect();
        try {
          const s = await enrichCompany(client, c.companyId, { enrichVersion: version, fx });
          sum.seen += s.seen;
          sum.enriched += s.enriched;
          sum.created += s.created;
          sum.attached += s.attached;
          sum.errors += s.errors;
          for (const e of s.errorSamples) if (sum.errorSamples.length < 10) sum.errorSamples.push(e);
        } finally {
          client.release();
        }
        doneCompanies++;
        const secs = Math.round((Date.now() - started) / 1000);
        console.log(`  [${doneCompanies}/${todo.length}] enriched=${sum.enriched}/${total} errors=${sum.errors} ${secs}s`);
      }
    }),
  );
  const tail = await pool.connect();
  try {
    console.log(`lifecycle: ${JSON.stringify(await syncJobLifecycle(tail))}`);
  } finally {
    tail.release();
  }
  console.log(`done: ${JSON.stringify(sum)}`);
  await close();
  if (sum.errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
