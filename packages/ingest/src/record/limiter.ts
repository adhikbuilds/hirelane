export interface HostLimiterOptions {
  minIntervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HostLimiter {
  /** Runs fn after the host's min interval has elapsed since the previous call started. Calls per host are serialised. */
  run<T>(host: string, fn: () => Promise<T>): Promise<T>;
}

/** Per-host spacing: at most one call start per minIntervalMs per host; different hosts are independent. */
export function createHostLimiter(opts: HostLimiterOptions): HostLimiter {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const tails = new Map<string, Promise<unknown>>();
  const lastStart = new Map<string, number>();

  return {
    run<T>(host: string, fn: () => Promise<T>): Promise<T> {
      const prev = tails.get(host) ?? Promise.resolve();
      const job = prev
        .catch(() => undefined)
        .then(async () => {
          const last = lastStart.get(host);
          if (last !== undefined) {
            const wait = last + opts.minIntervalMs - now();
            if (wait > 0) await sleep(wait);
          }
          lastStart.set(host, now());
          return fn();
        });
      tails.set(host, job);
      return job;
    },
  };
}
