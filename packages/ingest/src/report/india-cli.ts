/** `pnpm ingest:india-report [--since ISO] [--json]`. Read-only. "New" = first seen at or after --since (default 24 h ago). */
import { close, withAdmin } from '@hirelane/db';
import { requireDatabaseUrl } from '@hirelane/db/env';
import { summarizeIndia, type IndiaJobRow } from './india';

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  requireDatabaseUrl();
  const now = new Date();
  const since = arg('--since') ? new Date(arg('--since')!) : new Date(now.getTime() - 86_400_000);
  if (Number.isNaN(since.getTime())) throw new Error('--since must be an ISO date');
  const rows = await withAdmin(async (c) => {
    const r = await c.query(
      `SELECT c.name AS company, j.title, j.level, j.locations, j.source_kind, j.source_label, j.posted_at, j.first_seen_at
         FROM jobs j JOIN companies c ON c.id = j.company_id
        WHERE 'IN' = ANY(j.countries) AND j.closed_at IS NULL`,
    );
    return r.rows.map(
      (x): IndiaJobRow => ({
        company: x.company, title: x.title, level: x.level, locations: x.locations, sourceKind: x.source_kind,
        sourceLabel: x.source_label, postedAt: x.posted_at, firstSeenAt: x.first_seen_at,
      }),
    );
  });
  const s = summarizeIndia(rows, { now, since });
  if (process.argv.includes('--json')) return void console.log(JSON.stringify(s, null, 2));
  const tbl = (t: string, xs: { key: string; n: number }[]) => console.log(`\n${t}\n` + xs.map((x) => `  ${String(x.n).padStart(5)}  ${x.key}`).join('\n'));
  console.log(`India open roles: ${s.total} (fresher-friendly ${s.fresherFriendly}); new since ${since.toISOString()}: ${s.newTotal}`);
  tbl('By city', s.byCity.slice(0, 25));
  tbl('By source', s.bySource);
  tbl('By source label (top 25)', s.bySourceLabel);
  tbl('By freshness', Object.entries(s.byFreshness).map(([key, n]) => ({ key, n })));
  tbl('Top new India employers', s.topNewEmployers.map((e) => ({ key: e.company, n: e.n })));
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(close);
