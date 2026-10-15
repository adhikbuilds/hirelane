import { describe, expect, it } from 'vitest';
import { createHostLimiter } from '../src/record/limiter';

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe('createHostLimiter', () => {
  it('spaces calls to one host at least minIntervalMs apart', async () => {
    const c = fakeClock();
    const lim = createHostLimiter({ minIntervalMs: 1000, ...c });
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map(() => lim.run('a.example', async () => void starts.push(c.now()))));
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it('does not delay a different host', async () => {
    const c = fakeClock();
    const lim = createHostLimiter({ minIntervalMs: 1000, ...c });
    const starts: Record<string, number> = {};
    await lim.run('a.example', async () => void (starts.a = c.now()));
    await lim.run('b.example', async () => void (starts.b = c.now()));
    expect(starts).toEqual({ a: 0, b: 0 });
  });

  it('does not sleep when the interval already elapsed', async () => {
    const c = fakeClock();
    const lim = createHostLimiter({ minIntervalMs: 1000, ...c });
    await lim.run('a.example', async () => {});
    await c.sleep(5000);
    const before = c.now();
    await lim.run('a.example', async () => {});
    expect(c.now()).toBe(before);
  });

  it('keeps spacing after a failing call and propagates its error', async () => {
    const c = fakeClock();
    const lim = createHostLimiter({ minIntervalMs: 1000, ...c });
    await expect(lim.run('a.example', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    let at = -1;
    await lim.run('a.example', async () => void (at = c.now()));
    expect(at).toBe(1000);
  });
});
