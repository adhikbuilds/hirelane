/** `pnpm --filter @hirelane/ingest discover`. Probes public ATS boards for seed companies; writes .cache/discovery/<date>.jsonl. No DB writes. */
import { formatSummary, summarize } from './probe';
import { loadKnown, loadSeedNames, runDiscovery } from './run';

async function main(): Promise<number> {
  const names = loadSeedNames();
  const known = loadKnown();
  let done = 0;
  const { result, file, candidates } = await runDiscovery({
    names,
    known,
    probe: {
      fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
      onResult: (r) => {
        done++;
        if (r.outcome === 'hit') console.log(`  hit ${r.ats}:${r.token} (${r.name})`);
        if (done % 200 === 0) console.log(`  ... ${done} requests`);
      },
    },
  });
  console.log(`seed names: ${names.length}, candidate tokens: ${candidates.length}`);
  console.log(formatSummary(summarize(result)));
  console.log(`\nhits written to ${file}`);
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
