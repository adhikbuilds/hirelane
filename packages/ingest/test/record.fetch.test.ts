import { describe, expect, it } from 'vitest';
import { fetchCapped, RECORDER_USER_AGENT } from '../src/record/fetch';

const body = (n: number, chunk = 1024): ReadableStream<Uint8Array> => {
  let sent = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (sent >= n) return ctrl.close();
      const size = Math.min(chunk, n - sent);
      sent += size;
      ctrl.enqueue(new Uint8Array(size).fill(97));
    },
  });
};
const ok = (n: number, status = 200, headers: Record<string, string> = {}) =>
  new Response(body(n), { status, headers });

describe('fetchCapped', () => {
  it('sends the Hirelane UA and returns the full body', async () => {
    let seen: Record<string, string> = {};
    const r = await fetchCapped('https://x.example/a', {
      fetch: async (_u, init) => {
        seen = init.headers as Record<string, string>;
        return ok(100);
      },
      maxBytes: 1000,
      timeoutMs: 1000,
    });
    expect(RECORDER_USER_AGENT).toBe('HirelaneBot/0.1 (+http://localhost:3001/contact)');
    expect(seen['User-Agent']).toBe(RECORDER_USER_AGENT);
    expect(r).toMatchObject({ kind: 'ok', status: 200 });
    expect(r.kind === 'ok' && r.bytes.length).toBe(100);
  });

  it('accepts a body of exactly maxBytes', async () => {
    const r = await fetchCapped('https://x.example/a', { fetch: async () => ok(1000), maxBytes: 1000, timeoutMs: 1000 });
    expect(r.kind).toBe('ok');
  });

  it('rejects a body over maxBytes and cancels the stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        ctrl.enqueue(new Uint8Array(512));
      },
      cancel() {
        cancelled = true;
      },
    });
    const r = await fetchCapped('https://x.example/a', {
      fetch: async () => new Response(stream, { status: 200 }),
      maxBytes: 2000,
      timeoutMs: 1000,
    });
    expect(r).toMatchObject({ kind: 'too_large', limitBytes: 2000 });
    expect(cancelled).toBe(true);
  });

  it('rejects early on an oversized content-length without reading', async () => {
    const r = await fetchCapped('https://x.example/a', {
      fetch: async () => ok(10, 200, { 'content-length': '999999' }),
      maxBytes: 1000,
      timeoutMs: 1000,
    });
    expect(r.kind).toBe('too_large');
  });

  it('reports non-2xx as http with the status and no body', async () => {
    const r = await fetchCapped('https://x.example/a', { fetch: async () => ok(5, 404), maxBytes: 1000, timeoutMs: 1000 });
    expect(r).toEqual({ kind: 'http', status: 404, retryAfterMs: null });
  });

  it('parses Retry-After seconds on 429', async () => {
    const r = await fetchCapped('https://x.example/a', {
      fetch: async () => ok(0, 429, { 'retry-after': '7' }),
      maxBytes: 1000,
      timeoutMs: 1000,
    });
    expect(r).toEqual({ kind: 'http', status: 429, retryAfterMs: 7000 });
  });

  it('times out when the request never settles', async () => {
    const r = await fetchCapped('https://x.example/a', {
      fetch: (_u, init) =>
        new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
      maxBytes: 1000,
      timeoutMs: 20,
    });
    expect(r.kind).toBe('timeout');
  });

  it('maps a thrown fetch error to network', async () => {
    const r = await fetchCapped('https://x.example/a', {
      fetch: async () => {
        throw new Error('ECONNRESET');
      },
      maxBytes: 1000,
      timeoutMs: 1000,
    });
    expect(r).toEqual({ kind: 'network', message: 'ECONNRESET' });
  });

  it('refuses non-https URLs', async () => {
    await expect(
      fetchCapped('http://x.example/a', { fetch: async () => ok(1), maxBytes: 10, timeoutMs: 10 }),
    ).rejects.toThrow(/https/);
  });
});
