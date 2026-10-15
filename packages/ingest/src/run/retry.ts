/** Board-level retry: transient failures only, exponential backoff with jitter, Retry-After honoured (capped). */
import type { Connector, FetchBoardError, FetchBoardOptions, FetchBoardResult, IngestMode } from '../contract';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Upper bound on how long a server's Retry-After may make us wait. */
  maxRetryAfterMs: number;
  sleep: (ms: number) => Promise<void>;
  /** In [0, 1); injectable for tests. */
  random: () => number;
}

export function defaultRetryPolicy(mode: IngestMode, over: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    maxAttempts: 3,
    // Fixture mode has no server to be polite to: retry immediately so a 500 never costs wall time.
    baseDelayMs: mode === 'live' ? 1000 : 0,
    maxDelayMs: 30_000,
    maxRetryAfterMs: 60_000,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: Math.random,
    ...over,
  };
}

export function isRetryable(e: FetchBoardError): boolean {
  switch (e.kind) {
    case 'http':
      return e.status >= 500;
    case 'timeout':
    case 'network':
    case 'rate_limited':
      return true;
    default:
      return false;
  }
}

/** Delay before attempt `attempt + 1`. `attempt` is the 1-based number of the attempt that just failed. */
export function computeDelayMs(e: FetchBoardError, attempt: number, p: RetryPolicy): number {
  const ceiling = Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** (attempt - 1));
  const backoff = Math.round(ceiling * (0.5 + 0.5 * p.random()));
  const retryAfter = e.kind === 'rate_limited' && e.retryAfterMs !== null ? Math.min(e.retryAfterMs, p.maxRetryAfterMs) : 0;
  return Math.max(backoff, retryAfter);
}

export async function fetchBoardWithRetry(
  connector: Connector,
  token: string,
  opts: FetchBoardOptions,
  policy: RetryPolicy,
): Promise<{ result: FetchBoardResult; attempts: number }> {
  let attempts = 0;
  for (;;) {
    attempts++;
    const result = await connector.fetchBoard(token, opts);
    if (result.ok || !isRetryable(result.error) || attempts >= policy.maxAttempts || opts.signal.aborted) {
      return { result, attempts };
    }
    await policy.sleep(computeDelayMs(result.error, attempts, policy));
    if (opts.signal.aborted) return { result, attempts };
  }
}
