/**
 * SSRF-guarded GET for company logo assets. Policy, in order, for the first URL and for every redirect hop:
 *   https on 443 only, no credentials, no IP-literal hosts, host == company domain or a subdomain of it,
 *   every resolved address public. At most 2 redirects (manual), body streamed with a hard byte cap,
 *   content-type allowlist. The connect-time pin lives in transport.ts; the lookup here is the pre-flight check.
 */
import { isIP } from 'node:net';
import { isPublicIp } from './ip';

export type Lookup = (host: string) => Promise<string[]>;
export type GuardFetch = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> },
) => Promise<Response>;
export interface GuardDeps {
  fetch: GuardFetch;
  lookup: Lookup;
}

export type RejectReason =
  | 'bad_url'
  | 'not_https'
  | 'bad_port'
  | 'cross_domain'
  | 'dns_failed'
  | 'private_ip'
  | 'bad_redirect'
  | 'too_many_redirects'
  | 'http_status'
  | 'bad_content_type'
  | 'too_large'
  | 'network'
  | 'magic_mismatch'
  | 'bad_image'
  | 'too_small'
  | 'too_many_pixels';

export class LogoRejected extends Error {
  constructor(
    public readonly reason: RejectReason,
    public readonly detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'LogoRejected';
  }
}

export interface GuardOptions {
  /** Canonical company domain (no www). */
  domain: string;
  maxBytes: number;
  allowedTypes: readonly string[];
  /** Return the first maxBytes instead of rejecting (used for HTML, where the head is all we need). */
  truncate?: boolean;
  timeoutMs?: number;
}

export interface GuardedResponse {
  finalUrl: string;
  contentType: string;
  body: Buffer;
}

export const MAX_REDIRECTS = 2;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function isOwnHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

async function vet(raw: string, domain: string, lookup: Lookup): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new LogoRejected('bad_url');
  }
  if (u.protocol !== 'https:') throw new LogoRejected('not_https');
  if (u.username || u.password) throw new LogoRejected('bad_url', 'credentials');
  if (u.port && u.port !== '443') throw new LogoRejected('bad_port');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || isIP(host) !== 0) throw new LogoRejected('bad_url', 'ip literal');
  if (!isOwnHost(host, domain)) throw new LogoRejected('cross_domain', host);
  let addrs: string[];
  try {
    addrs = await lookup(host);
  } catch {
    throw new LogoRejected('dns_failed', host);
  }
  if (!Array.isArray(addrs) || addrs.length === 0) throw new LogoRejected('dns_failed', host);
  if (!addrs.every(isPublicIp)) throw new LogoRejected('private_ip', host);
  return u;
}

async function readCapped(res: Response, max: number, truncate: boolean): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        if (!truncate) throw new LogoRejected('too_large');
        chunks.push(Buffer.from(value.subarray(0, value.byteLength - (total - max))));
        return Buffer.concat(chunks);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (e) {
    if (e instanceof LogoRejected) throw e;
    throw new LogoRejected('network', 'read');
  }
  return Buffer.concat(chunks);
}

export async function guardedGet(url: string, opts: GuardOptions, deps: GuardDeps): Promise<GuardedResponse> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 8000);
  try {
    let current = url;
    for (let hops = 0; ; hops++) {
      const u = await vet(current, opts.domain, deps.lookup);
      let res: Response;
      try {
        res = await deps.fetch(u.toString(), {
          redirect: 'manual',
          signal: ac.signal,
          headers: { accept: opts.allowedTypes.join(', '), 'user-agent': 'HirelaneLogoBot/1.0' },
        });
      } catch {
        throw new LogoRejected('network');
      }
      if (REDIRECT_STATUSES.has(res.status)) {
        await res.body?.cancel().catch(() => {});
        const loc = res.headers.get('location');
        if (!loc) throw new LogoRejected('bad_redirect', 'no location');
        if (hops >= MAX_REDIRECTS) throw new LogoRejected('too_many_redirects');
        try {
          current = new URL(loc, u).toString();
        } catch {
          throw new LogoRejected('bad_redirect', 'unparseable location');
        }
        continue;
      }
      if (res.status < 200 || res.status > 299) {
        await res.body?.cancel().catch(() => {});
        throw new LogoRejected('http_status', String(res.status));
      }
      const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!opts.allowedTypes.includes(contentType)) {
        await res.body?.cancel().catch(() => {});
        throw new LogoRejected('bad_content_type', contentType);
      }
      const declared = Number(res.headers.get('content-length'));
      if (!opts.truncate && Number.isFinite(declared) && declared > opts.maxBytes) {
        await res.body?.cancel().catch(() => {});
        throw new LogoRejected('too_large', 'content-length');
      }
      const body = await readCapped(res, opts.maxBytes, opts.truncate === true);
      return { finalUrl: u.toString(), contentType, body };
    }
  } finally {
    clearTimeout(timer);
  }
}
