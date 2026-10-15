/** `pnpm report:coverage`: prints enrichment coverage from the dev database; exits 1 below any target. */
import { close, coverageStats, withAdmin } from '../packages/db/src/index';
import { evaluate, formatReport } from './report-coverage-lib';

async function main(): Promise<void> {
  const stats = await withAdmin((c) => coverageStats(c));
  const report = evaluate(stats);
  console.log(formatReport(report, stats));
  await close();
  if (!report.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
