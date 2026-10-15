export const RECORDER_USER_AGENT = 'HirelaneBot/0.1 (+http://localhost:3001/contact)';
export const MAX_BYTES = 20 * 1024 * 1024;
export const TIMEOUT_MS = 30_000;

export type CappedResult =
  | { kind: 'ok'; status: number; bytes: Buffer }
  | { kind: 'http'; status: number; retryAfterMs: number | null }
  | { kind: 'too_large'; limitBytes: number }
  | { kind: 'timeout' }
  | { kind: 'network'; message: string };

export interface CappedOptions {
  fetch: (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
  maxBytes?: number;
  timeoutMs?: number;
}

export function parseRetryAfter(v: string | null, nowMs = Date.now()): number | null {
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

/** One GET with a timeout covering headers and body, and a streamed (decompressed) body cap. Never throws on network conditions. */
export async function fetchCapped(url: string, opts: CappedOptions): Promise<CappedResult> {
  if (!url.startsWith('https://')) throw new Error(`refusing non-https url: ${url}`);
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await opts.fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': RECORDER_USER_AGENT, Accept: 'application/json' },
    });
    if (res.status < 200 || res.status > 299) {
      await res.body?.cancel().catch(() => undefined);
      return { kind: 'http', status: res.status, retryAfterMs: parseRetryAfter(res.headers.get('retry-after')) };
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      return { kind: 'too_large', limitBytes: maxBytes };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { kind: 'too_large', limitBytes: maxBytes };
        }
        chunks.push(value);
      }
    }
    return { kind: 'ok', status: res.status, bytes: Buffer.concat(chunks) };
  } catch (e) {
    if (timedOut) return { kind: 'timeout' };
    return { kind: 'network', message: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
