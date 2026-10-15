/**
 * Fetch policy for board requests: per-host spacing, 30 s timeout over headers AND body, and a
 * streamed 20 MB cap. Satisfies the connector's `BoardFetch`: policy failures throw
 * FetchPolicyError, everything else comes back as a Response.
 */
import { FetchPolicyError, type BoardFetch } from '../contract';
import { RECORDER_USER_AGENT } from '../record/fetch';
import type { HostLimiter } from '../record/limiter';

export const MAX_BYTES = 20 * 1024 * 1024;
export const TIMEOUT_MS = 30_000;

export interface PolicyFetchOptions {
  rawFetch: BoardFetch;
  limiter: HostLimiter;
  maxBytes?: number;
  timeoutMs?: number;
  userAgent?: string;
}

const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

export function createPolicyFetch(opts: PolicyFetchOptions): BoardFetch {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const userAgent = opts.userAgent ?? RECORDER_USER_AGENT;

  return (url, init) => {
    if (!url.startsWith('https://')) return Promise.reject(new Error(`refusing non-https url: ${url}`));
    const host = new URL(url).hostname;
    return opts.limiter.run(host, async () => {
      if (init.signal.aborted) throw new DOMException('aborted', 'AbortError');
      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, timeoutMs);
      const onParentAbort = () => ctrl.abort();
      init.signal.addEventListener('abort', onParentAbort, { once: true });

      try {
        const res = await opts.rawFetch(url, {
          signal: ctrl.signal,
          headers: { ...init.headers, 'user-agent': userAgent },
        });
        if (res.status < 200 || res.status > 299) {
          await res.body?.cancel().catch(() => undefined);
          return new Response(null, { status: res.status, headers: res.headers });
        }
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) {
          await res.body?.cancel().catch(() => undefined);
          throw new FetchPolicyError('too_large', { limitBytes: maxBytes, bytes: declared });
        }
        const chunks: Uint8Array[] = [];
        let total = 0;
        if (res.body) {
          const reader = res.body.getReader();
          // A stalled body must not outlive the timeout, whether or not the transport honours the signal.
          const stalled = new Promise<never>((_, reject) => {
            const fail = () => reject(new DOMException('aborted', 'AbortError'));
            if (ctrl.signal.aborted) fail();
            else ctrl.signal.addEventListener('abort', fail, { once: true });
          });
          stalled.catch(() => undefined);
          for (;;) {
            const { done, value } = await Promise.race([reader.read(), stalled]);
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
              await reader.cancel().catch(() => undefined);
              throw new FetchPolicyError('too_large', { limitBytes: maxBytes, bytes: total });
            }
            chunks.push(value);
          }
        }
        const headers = new Headers(res.headers);
        headers.delete('content-encoding'); // body is already decoded
        headers.delete('content-length');
        return new Response(Buffer.concat(chunks), { status: res.status, headers });
      } catch (e) {
        if (e instanceof FetchPolicyError) throw e;
        if (timedOut) throw new FetchPolicyError('timeout', { cause: e });
        if (init.signal.aborted || isAbort(e)) throw isAbort(e) ? e : new DOMException('aborted', 'AbortError');
        throw new FetchPolicyError('network', { cause: e });
      } finally {
        clearTimeout(timer);
        init.signal.removeEventListener('abort', onParentAbort);
      }
    });
  };
}
