import { describe, expect, it, vi } from 'vitest';
import type { Connector, FetchBoardError, FetchBoardResult } from '../src/contract';
import { computeDelayMs, fetchBoardWithRetry, isRetryable, type RetryPolicy } from '../src/run/retry';
import { opts, stubFetch } from './connectors.helpers';

const err = (error: FetchBoardError, httpStatus: number | null = null): FetchBoardResult => ({
  ok: false, ats: 'ashby', token: 't', error, httpStatus, bytes: 0, durationMs: 1,
});
const good: FetchBoardResult = {
  ok: true, ats: 'ashby', token: 't', source: 'fixture', postings: [], seenExternalIds: [], itemErrors: [],
  unlistedCount: 0, httpStatus: 200, bytes: 2, durationMs: 1,
};

function scripted(...results: FetchBoardResult[]): Connector & { calls: number } {
  const c = {
    ats: 'ashby' as const,
    calls: 0,
    boardUrl: () => 'https://x',
    fetchBoard: async () => results[Math.min(c.calls++, results.length - 1)]!,
  };
  return c;
}

const policy = (over: Partial<RetryPolicy> = {}): RetryPolicy => ({
  maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 10_000, maxRetryAfterMs: 5_000,
  sleep: vi.fn(async () => {}), random: () => 1, ...over,
});

describe('isRetryable', () => {
  it.each<[FetchBoardError, boolean]>([
    [{ kind: 'http', status: 500 }, true],
    [{ kind: 'http', status: 503 }, true],
    [{ kind: 'http', status: 403 }, false],
    [{ kind: 'timeout' }, true],
    [{ kind: 'network', message: 'x' }, true],
    [{ kind: 'rate_limited', retryAfterMs: null }, true],
    [{ kind: 'not_found' }, false],
    [{ kind: 'schema', issues: [] }, false],
    [{ kind: 'invalid_json', message: 'x' }, false],
    [{ kind: 'too_large', limitBytes: 1 }, false],
    [{ kind: 'aborted' }, false],
  ])('%j -> %s', (e, want) => expect(isRetryable(e)).toBe(want));
});

describe('computeDelayMs', () => {
  it('backs off exponentially and caps', () => {
    const p = policy({ random: () => 1 });
    const e: FetchBoardError = { kind: 'timeout' };
    expect([1, 2, 3].map((a) => computeDelayMs(e, a, p))).toEqual([100, 200, 400]);
    expect(computeDelayMs(e, 20, p)).toBe(10_000);
  });
  it('applies jitter between half and full backoff', () => {
    expect(computeDelayMs({ kind: 'timeout' }, 1, policy({ random: () => 0 }))).toBe(50);
  });
  it('honours Retry-After when larger than backoff, capped at maxRetryAfterMs', () => {
    const p = policy();
    expect(computeDelayMs({ kind: 'rate_limited', retryAfterMs: 3000 }, 1, p)).toBe(3000);
    expect(computeDelayMs({ kind: 'rate_limited', retryAfterMs: 900_000 }, 1, p)).toBe(5000);
    expect(computeDelayMs({ kind: 'rate_limited', retryAfterMs: 10 }, 1, p)).toBe(100);
  });
  it('is zero when the base delay is zero (fixture mode)', () => {
    expect(computeDelayMs({ kind: 'http', status: 500 }, 3, policy({ baseDelayMs: 0 }))).toBe(0);
  });
});

describe('fetchBoardWithRetry', () => {
  const o = opts(stubFetch('').fetch);

  it('returns success on the first attempt without sleeping', async () => {
    const c = scripted(good);
    const p = policy();
    const out = await fetchBoardWithRetry(c, 't', o, p);
    expect(out).toMatchObject({ attempts: 1, result: { ok: true } });
    expect(p.sleep).not.toHaveBeenCalled();
  });

  it('retries a 500 and succeeds on the third attempt, sleeping between', async () => {
    const c = scripted(err({ kind: 'http', status: 500 }, 500), err({ kind: 'http', status: 502 }, 502), good);
    const p = policy();
    const out = await fetchBoardWithRetry(c, 't', o, p);
    expect(out.attempts).toBe(3);
    expect(out.result.ok).toBe(true);
    expect(p.sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts and returns the last failure', async () => {
    const c = scripted(err({ kind: 'http', status: 500 }, 500));
    const out = await fetchBoardWithRetry(c, 't', o, policy());
    expect(c.calls).toBe(3);
    expect(out.attempts).toBe(3);
    expect(out.result).toMatchObject({ ok: false, error: { kind: 'http', status: 500 } });
  });

  it('does not retry a 404, schema or too_large failure', async () => {
    for (const e of [{ kind: 'not_found' }, { kind: 'schema', issues: ['x'] }, { kind: 'too_large', limitBytes: 1 }] as FetchBoardError[]) {
      const c = scripted(err(e));
      const out = await fetchBoardWithRetry(c, 't', o, policy());
      expect(c.calls).toBe(1);
      expect(out.attempts).toBe(1);
    }
  });

  it('sleeps for Retry-After on a 429', async () => {
    const c = scripted(err({ kind: 'rate_limited', retryAfterMs: 2500 }, 429), good);
    const p = policy();
    await fetchBoardWithRetry(c, 't', o, p);
    expect(p.sleep).toHaveBeenCalledWith(2500);
  });

  it('stops retrying once the signal is aborted', async () => {
    const ctrl = new AbortController();
    const c = scripted(err({ kind: 'timeout' }));
    const p = policy({
      sleep: vi.fn(async () => {
        ctrl.abort();
      }),
    });
    const out = await fetchBoardWithRetry(c, 't', { ...o, signal: ctrl.signal }, p);
    expect(out.attempts).toBe(1);
    expect(out.result.ok).toBe(false);
  });
});
