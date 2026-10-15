/**
 * `pnpm bench:board`: 30-second load against a running server, where each worker alternates a /jobs page and a /api/public/jobs call.
 *
 *   BENCH_URL       base URL (default http://localhost:3001)
 *   BENCH_SECONDS   duration (default 30)
 *   BENCH_CONCURRENCY  concurrent workers, each alternating both endpoints (default 8)
 *
 * Measure a production build (`next build && next start -p 3001`); dev mode compiles on demand and is not representative.
 * Start the server with TRUST_PROXY_HOPS=1: the bench sends a fresh X-Forwarded-For per request, otherwise the 60/min
 * per-IP public API limit (one shared bucket without a trusted proxy) turns most requests into 429s.
 * Exits 1 when a p95 budget is missed or any request fails.
 */
import { budgetReport, buildMix, ipFor, summarize, type Sample } from './bench-board-lib';

const base = (process.env['BENCH_URL'] ?? 'http://localhost:3001').replace(/\/$/, '');
const seconds = Number(process.env['BENCH_SECONDS'] ?? 30);
const workers = Number(process.env['BENCH_CONCURRENCY'] ?? 8);

let counter = 0;

async function hit(path: string): Promise<Sample> {
  const started = performance.now();
  try {
    const res = await fetch(base + path, { headers: { 'x-forwarded-for': ipFor(counter++), accept: '*/*' } });
    await res.arrayBuffer();
    return { ms: performance.now() - started, status: res.status };
  } catch {
    return { ms: performance.now() - started, status: 0 };
  }
}

/** Each worker alternates a /jobs page and an API call over the same filter, so the two endpoints share load 1:1. */
async function worker(deadline: number, jobs: Sample[], api: Sample[], offset: number): Promise<void> {
  const mix = buildMix();
  for (let i = offset; performance.now() < deadline; i++) {
    const entry = mix[i % mix.length]!;
    jobs.push(await hit(entry.jobs));
    api.push(await hit(entry.api));
  }
}

async function main(): Promise<void> {
  const mix = buildMix();
  // Warm-up: one pass over every URL so the 30 s window measures steady state, not first compile. Reported separately.
  const warm: Sample[] = [];
  for (const m of mix) warm.push(await hit(m.jobs), await hit(m.api));
  console.log(`warm-up: ${warm.length} requests, slowest ${Math.max(...warm.map((s) => s.ms)).toFixed(0)}ms, non-2xx ${warm.filter((s) => s.status < 200 || s.status >= 300).length}`);

  const jobs: Sample[] = [];
  const api: Sample[] = [];
  const deadline = performance.now() + seconds * 1000;
  console.log(`load: ${seconds}s, ${workers} workers alternating both endpoints, ${mix.length} urls, ${base}`);
  const started = performance.now();
  await Promise.all(Array.from({ length: workers }, (_, w) => worker(deadline, jobs, api, w * 5)));
  const elapsed = (performance.now() - started) / 1000;
  console.log(`throughput: /jobs ${(jobs.length / elapsed).toFixed(1)} req/s, api ${(api.length / elapsed).toFixed(1)} req/s`);

  const report = budgetReport({ jobs: summarize(jobs), api: summarize(api) });
  console.log(report.lines.join('\n'));
  if (!report.pass) {
    console.log('bench:board FAILED');
    process.exitCode = 1;
  } else {
    console.log('bench:board passed');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
