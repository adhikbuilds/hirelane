/** Pure helpers for `pnpm bench:board`: sampling, percentiles, the request mix and the p95 budgets. */

export type Sample = { ms: number; status: number };
export type Summary = {
  count: number;
  ok: number;
  failed: number;
  byStatus: Record<number, number>;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

export const BUDGET_MS = { jobs: 300, api: 150 } as const;

/** Nearest-rank percentile. NaN for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

/** Percentiles are over successful (2xx) requests only; any other status counts as a failure. */
export function summarize(samples: readonly Sample[]): Summary {
  const byStatus: Record<number, number> = {};
  for (const s of samples) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  const good = samples.filter((s) => s.status >= 200 && s.status < 300).map((s) => s.ms);
  return {
    count: samples.length,
    ok: good.length,
    failed: samples.length - good.length,
    byStatus,
    p50: percentile(good, 50),
    p95: percentile(good, 95),
    p99: percentile(good, 99),
    max: good.length ? Math.max(...good) : Number.NaN,
  };
}

/** A distinct 10.x.y.z per request index, so the per-IP limiter (60/min) never trips when TRUST_PROXY_HOPS=1. */
export function ipFor(i: number): string {
  const n = i % (254 * 254 * 254);
  return `10.${Math.floor(n / (254 * 254)) + 1}.${Math.floor(n / 254) % 254 + 1}.${(n % 254) + 1}`;
}

export type MixEntry = { jobs: string; api: string };

const ROLES = ['sales', 'software-engineer-general', 'solutions-engineer', 'operations-strategy', 'marketing', 'infrastructure-sre', 'finance', 'customer-success'];
const COUNTRIES = ['US', 'GB', 'CA', 'IN', 'DE'];
const QUERIES = ['engineer', 'data', 'account executive', 'python', 'designer'];

/** Deterministic mix of realistic filter URLs. The same query string drives the page and the API. */
export function buildMix(): MixEntry[] {
  const qs: string[] = [''];
  for (const role of ROLES) qs.push(`role=${role}`);
  for (const country of COUNTRIES) qs.push(`country=${country}`);
  qs.push('remote=1', 'salary=1', 'remote=1&salary=1', 'country=IN&remote=1&salary=1', 'workplace=hybrid', 'level=entry', 'level=experienced', 'visa=1', 'posted=7', 'sort=pay&salary=1');
  for (const q of QUERIES) qs.push(`q=${encodeURIComponent(q)}`);
  for (const role of ROLES.slice(0, 4)) for (const country of COUNTRIES.slice(0, 2)) qs.push(`role=${role}&country=${country}`);
  qs.push('page=2', 'page=5', 'page=20', 'country=US&page=3');
  return qs.map((q) => ({ jobs: q ? `/jobs?${q}` : '/jobs', api: q ? `/api/public/jobs?${q}` : '/api/public/jobs' }));
}

export function budgetReport(s: { jobs: Summary; api: Summary }): { pass: boolean; lines: string[] } {
  const lines: string[] = [];
  let pass = true;
  for (const [key, label] of [['jobs', '/jobs'], ['api', '/api/public/jobs']] as const) {
    const r = s[key];
    const budget = BUDGET_MS[key];
    const good = r.count > 0 && r.failed === 0 && r.p95 <= budget;
    if (!good) pass = false;
    const statuses = Object.entries(r.byStatus).map(([k, v]) => `${k}x${v}`).join(' ') || 'none';
    lines.push(
      `${label.padEnd(18)} n=${r.count} p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms p99=${r.p99.toFixed(1)}ms max=${r.max.toFixed(1)}ms ` +
        `budget p95<=${budget}ms failed=${r.failed} [${statuses}] ${good ? 'PASS' : 'FAIL'}`,
    );
  }
  return { pass, lines };
}
