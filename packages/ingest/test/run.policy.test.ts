import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchPolicyError } from '../src/contract';
import { createHostLimiter } from '../src/record/limiter';
import { createPolicyFetch, MAX_BYTES, TIMEOUT_MS } from '../src/run/policy';

const URL_ = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true';
const noLimit = createHostLimiter({ minIntervalMs: 0 });
const sig = () => new AbortController().signal;

afterEach(() => vi.useRealTimers());

describe('createPolicyFetch', () => {
  it('exposes the 20 MB and 30 s defaults', () => {
    expect(MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(TIMEOUT_MS).toBe(30_000);
  });

  it('sends the bot user agent, keeps accept, and routes through the host limiter by hostname', async () => {
    const seen: Record<string, string>[] = [];
    const run = vi.fn((_h: string, fn: () => Promise<unknown>) => fn());
    const f = createPolicyFetch({
      rawFetch: async (_u, init) => {
        seen.push(init.headers);
        return new Response('[]');
      },
      limiter: { run } as never,
    });
    await f(URL_, { signal: sig(), headers: { accept: 'application/json' } });
    expect(run.mock.calls[0]![0]).toBe('boards-api.greenhouse.io');
    expect(seen[0]!['user-agent']).toMatch(/^HirelaneBot\/0\.1/);
    expect(seen[0]!['accept']).toBe('application/json');
  });

  it('returns a 2xx body as a Response the connector can read', async () => {
    const f = createPolicyFetch({ rawFetch: async () => new Response('{"jobs":[]}', { status: 200 }), limiter: noLimit });
    const res = await f(URL_, { signal: sig(), headers: {} });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"jobs":[]}');
  });

  it('returns non-2xx responses untouched, with Retry-After intact', async () => {
    const f = createPolicyFetch({
      rawFetch: async () => new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }),
      limiter: noLimit,
    });
    const res = await f(URL_, { signal: sig(), headers: {} });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('7');
  });

  it('rejects a declared content-length over the cap before reading', async () => {
    const f = createPolicyFetch({
      rawFetch: async () => new Response('x', { headers: { 'content-length': '100' } }),
      limiter: noLimit,
      maxBytes: 10,
    });
    await expect(f(URL_, { signal: sig(), headers: {} })).rejects.toMatchObject({ name: 'FetchPolicyError', kind: 'too_large', detail: { limitBytes: 10 } });
  });

  it('caps a streamed body that never declares a length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(8));
      },
    });
    const f = createPolicyFetch({ rawFetch: async () => new Response(stream), limiter: noLimit, maxBytes: 20 });
    await expect(f(URL_, { signal: sig(), headers: {} })).rejects.toMatchObject({ kind: 'too_large' });
  });

  it('accepts a body exactly at the cap', async () => {
    const f = createPolicyFetch({ rawFetch: async () => new Response('x'.repeat(10)), limiter: noLimit, maxBytes: 10 });
    const res = await f(URL_, { signal: sig(), headers: {} });
    expect((await res.text()).length).toBe(10);
  });

  it('times out a request that never answers', async () => {
    vi.useFakeTimers();
    const f = createPolicyFetch({
      rawFetch: (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
      limiter: noLimit,
      timeoutMs: 1000,
    });
    const p = f(URL_, { signal: sig(), headers: {} });
    const assertion = expect(p).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it('times out a body that stalls after the headers', async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    const f = createPolicyFetch({ rawFetch: async () => new Response(stream), limiter: noLimit, timeoutMs: 500 });
    const p = f(URL_, { signal: sig(), headers: {} });
    const assertion = expect(p).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(501);
    await assertion;
  });

  it('maps a socket error to a network FetchPolicyError carrying the cause', async () => {
    const cause = new Error('ECONNRESET');
    const f = createPolicyFetch({
      rawFetch: async () => {
        throw cause;
      },
      limiter: noLimit,
    });
    const err = await f(URL_, { signal: sig(), headers: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(FetchPolicyError);
    expect(err.kind).toBe('network');
    expect(err.detail.cause).toBe(cause);
  });

  it('lets a caller abort surface as an AbortError, not a policy error', async () => {
    const ctrl = new AbortController();
    const f = createPolicyFetch({
      rawFetch: (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))),
      limiter: noLimit,
    });
    const p = f(URL_, { signal: ctrl.signal, headers: {} });
    ctrl.abort();
    const err = await p.catch((e) => e);
    expect(err).not.toBeInstanceOf(FetchPolicyError);
    expect(err.name).toBe('AbortError');
  });

  it('refuses a non-https url', async () => {
    const f = createPolicyFetch({ rawFetch: async () => new Response('x'), limiter: noLimit });
    await expect(f('http://example.com/x', { signal: sig(), headers: {} })).rejects.toThrow(/https/);
  });
});
