/**
 * Production transport for the logo fetcher. DNS is resolved INSIDE the socket's `lookup` hook and the connection is
 * made to the exact address that was validated, so a rebinding resolver cannot swap in a private address between
 * the check and the connect. Always https, never follows redirects (guardedGet does that, hop by hop).
 */
import dns from 'node:dns';
import https from 'node:https';
import { Readable } from 'node:stream';
import { isPublicIp } from './ip';
import type { GuardFetch, Lookup } from './logo-fetch';

export const systemLookup: Lookup = async (host) => (await dns.promises.lookup(host, { all: true, verbatim: true })).map((a) => a.address);

const NULL_BODY = new Set([204, 205, 304]);

export function createGuardedFetch(lookup: Lookup = systemLookup): GuardFetch {
  return (url, init) =>
    new Promise((resolve, reject) => {
      let u: URL;
      try {
        u = new URL(url);
      } catch (e) {
        reject(e);
        return;
      }
      if (u.protocol !== 'https:') {
        reject(new Error('transport: https only'));
        return;
      }
      const guardedLookup = (host: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) => {
        lookup(host).then(
          (addrs) => {
            if (addrs.length === 0 || !addrs.every(isPublicIp)) {
              cb(new Error('private_ip'));
              return;
            }
            const family = (a: string) => (a.includes(':') ? 6 : 4);
            if (options?.all) cb(null, addrs.map((address) => ({ address, family: family(address) })));
            else cb(null, addrs[0], family(addrs[0]!));
          },
          (e) => cb(e),
        );
      };
      const req = https.request(
        u,
        { method: 'GET', headers: init.headers, signal: init.signal, lookup: guardedLookup as never, agent: false, timeout: 10_000 },
        (res) => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
            else if (v !== undefined) headers.set(k, v);
          }
          const status = res.statusCode ?? 0;
          if (status < 200 || status > 599) {
            res.destroy();
            reject(new Error(`transport: unexpected status ${status}`));
            return;
          }
          const body = NULL_BODY.has(status) ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
          if (!body) res.resume();
          resolve(new Response(body, { status, headers }));
        },
      );
      req.on('timeout', () => req.destroy(new Error('transport: timeout')));
      req.on('error', reject);
      req.end();
    });
}
