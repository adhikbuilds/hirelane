import { describe, expect, it } from 'vitest';
import { budgetReport, buildMix, ipFor, percentile, summarize } from '../bench-board-lib';

describe('percentile', () => {
  it('uses the nearest-rank method', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 99)).toBe(99);
    expect(percentile(xs, 100)).toBe(100);
  });
  it('does not depend on input order and does not mutate it', () => {
    const xs = [9, 1, 5, 3, 7];
    expect(percentile(xs, 50)).toBe(5);
    expect(xs).toEqual([9, 1, 5, 3, 7]);
  });
  it('handles one sample and an empty list', () => {
    expect(percentile([42], 95)).toBe(42);
    expect(Number.isNaN(percentile([], 95))).toBe(true);
  });
});

describe('summarize', () => {
  it('counts ok and failed samples separately and takes percentiles over ok latencies only', () => {
    const s = summarize([
      { ms: 10, status: 200 },
      { ms: 20, status: 200 },
      { ms: 30, status: 200 },
      { ms: 5000, status: 500 },
      { ms: 1, status: 429 },
    ]);
    expect(s.count).toBe(5);
    expect(s.ok).toBe(3);
    expect(s.failed).toBe(2);
    expect(s.byStatus).toEqual({ 200: 3, 429: 1, 500: 1 });
    expect(s.p95).toBe(30);
    expect(s.max).toBe(30);
  });
  it('treats network failures (status 0) as failed', () => {
    expect(summarize([{ ms: 1, status: 0 }]).failed).toBe(1);
  });
});

describe('ipFor', () => {
  it('spreads requests over many addresses so no single one nears 60 per minute', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < 6000; i++) seen.set(ipFor(i), (seen.get(ipFor(i)) ?? 0) + 1);
    expect(Math.max(...seen.values())).toBeLessThanOrEqual(2);
  });
  it('emits valid dotted quads', () => {
    for (const i of [0, 1, 255, 256, 65535, 100000]) expect(ipFor(i)).toMatch(/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  });
});

describe('buildMix', () => {
  const mix = buildMix();
  it('has distinct html and api paths with the same filters', () => {
    expect(mix.length).toBeGreaterThanOrEqual(30);
    expect(new Set(mix.map((m) => m.jobs)).size).toBe(mix.length);
    for (const m of mix) {
      expect(m.jobs.startsWith('/jobs')).toBe(true);
      expect(m.api.startsWith('/api/public/jobs')).toBe(true);
      expect(m.jobs.split('?')[1] ?? '').toBe(m.api.split('?')[1] ?? '');
    }
  });
  it('is deterministic and includes the unfiltered board', () => {
    expect(buildMix()).toEqual(mix);
    expect(mix[0]!.jobs).toBe('/jobs');
  });
});

describe('budgetReport', () => {
  const ok = { count: 10, ok: 10, failed: 0, byStatus: { 200: 10 }, p50: 1, p95: 100, p99: 120, max: 130 };
  it('passes when p95 is at or under budget and nothing failed', () => {
    expect(budgetReport({ jobs: ok, api: { ...ok, p95: 150 } }).pass).toBe(true);
  });
  it('fails on a p95 over budget', () => {
    const r = budgetReport({ jobs: { ...ok, p95: 301 }, api: ok });
    expect(r.pass).toBe(false);
    expect(r.lines.join('\n')).toMatch(/\/jobs.*FAIL/);
  });
  it('fails on any failed request even when the latency is fine', () => {
    expect(budgetReport({ jobs: ok, api: { ...ok, failed: 1, byStatus: { 200: 9, 429: 1 } } }).pass).toBe(false);
  });
  it('fails when an endpoint got no samples', () => {
    const none = { count: 0, ok: 0, failed: 0, byStatus: {}, p50: NaN, p95: NaN, p99: NaN, max: NaN };
    expect(budgetReport({ jobs: none, api: ok }).pass).toBe(false);
  });
});
