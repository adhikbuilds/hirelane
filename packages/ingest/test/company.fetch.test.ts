import { describe, expect, it } from 'vitest';
import { guardedGet, LogoRejected, type GuardDeps } from '../src/company/logo-fetch';
import { mockWorld, pngOf } from './company.helpers';

const PUB = ['93.184.216.34'];
const opts = (over = {}) => ({ domain: 'acme.com', maxBytes: 200 * 1024, allowedTypes: ['image/png'], ...over });
const deps = (w: ReturnType<typeof mockWorld>): GuardDeps => ({ fetch: w.fetch, lookup: w.lookup });
const reason = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof LogoRejected) return e.reason;
    throw e;
  }
  return 'no-error';
};

describe('guardedGet', () => {
  it('fetches an https own-domain image and returns bytes + type', async () => {
    const png = await pngOf(64);
    const w = mockWorld({ 'https://acme.com/a.png': { headers: { 'content-type': 'image/PNG; charset=x' }, body: png } }, { 'acme.com': PUB });
    const r = await guardedGet('https://acme.com/a.png', opts(), deps(w));
    expect(r.contentType).toBe('image/png');
    expect(r.body.equals(png)).toBe(true);
    expect(r.finalUrl).toBe('https://acme.com/a.png');
  });

  it('rejects http, custom ports, credentials and foreign hosts before any I/O', async () => {
    const w = mockWorld({}, { 'acme.com': PUB, 'evil.com': PUB });
    expect(await reason(guardedGet('http://acme.com/a.png', opts(), deps(w)))).toBe('not_https');
    expect(await reason(guardedGet('https://acme.com:8443/a.png', opts(), deps(w)))).toBe('bad_port');
    expect(await reason(guardedGet('https://u:p@acme.com/a.png', opts(), deps(w)))).toBe('bad_url');
    expect(await reason(guardedGet('https://evil.com/a.png', opts(), deps(w)))).toBe('cross_domain');
    expect(await reason(guardedGet('https://notacme.com/a.png', opts(), deps(w)))).toBe('cross_domain');
    expect(await reason(guardedGet('https://acme.com.evil.com/a.png', opts(), deps(w)))).toBe('cross_domain');
    expect(w.calls).toEqual([]);
  });

  it('allows subdomains of the company domain', async () => {
    const png = await pngOf(8);
    const w = mockWorld({ 'https://cdn.acme.com/a.png': { headers: { 'content-type': 'image/png' }, body: png } }, { 'cdn.acme.com': PUB });
    expect((await guardedGet('https://cdn.acme.com/a.png', opts(), deps(w))).body.length).toBe(png.length);
  });

  it.each([
    ['127.0.0.1'],
    ['10.1.2.3'],
    ['169.254.169.254'],
    ['::1'],
    ['fe80::1'],
    ['::ffff:192.168.0.1'],
  ])('rejects a host resolving to %s', async (ip) => {
    const w = mockWorld({}, { 'acme.com': [ip] });
    expect(await reason(guardedGet('https://acme.com/a.png', opts(), deps(w)))).toBe('private_ip');
    expect(w.calls).toEqual([]);
  });

  it('rejects when ANY resolved address is private (mixed answer)', async () => {
    const w = mockWorld({}, { 'acme.com': ['93.184.216.34', '10.0.0.5'] });
    expect(await reason(guardedGet('https://acme.com/a.png', opts(), deps(w)))).toBe('private_ip');
  });

  it('rejects when DNS fails or returns nothing', async () => {
    expect(await reason(guardedGet('https://acme.com/a.png', opts(), deps(mockWorld({}, {}))))).toBe('dns_failed');
    expect(await reason(guardedGet('https://acme.com/a.png', opts(), deps(mockWorld({}, { 'acme.com': [] }))))).toBe('dns_failed');
  });

  it('rejects IP-literal hosts', async () => {
    const w = mockWorld({}, {});
    expect(await reason(guardedGet('https://127.0.0.1/a.png', opts({ domain: '127.0.0.1' }), deps(w)))).toBe('bad_url');
    expect(await reason(guardedGet('https://[::1]/a.png', opts(), deps(w)))).toBe('bad_url');
  });

  describe('redirects', () => {
    const png = Buffer.from('ok');
    const img = { headers: { 'content-type': 'image/png' }, body: png };
    const dns = { 'acme.com': PUB, 'www.acme.com': PUB, 'cdn.acme.com': PUB, 'evil.com': PUB, 'internal.acme.com': ['10.0.0.9'] };

    it('follows up to 2 same-domain redirects, relative Location included', async () => {
      const w = mockWorld(
        {
          'https://acme.com/a': { status: 301, headers: { location: 'https://www.acme.com/b' } },
          'https://www.acme.com/b': { status: 302, headers: { location: '/c.png' } },
          'https://www.acme.com/c.png': img,
        },
        dns,
      );
      const r = await guardedGet('https://acme.com/a', opts(), deps(w));
      expect(r.finalUrl).toBe('https://www.acme.com/c.png');
      expect(w.calls).toHaveLength(3);
    });

    it('rejects a third redirect', async () => {
      const w = mockWorld(
        {
          'https://acme.com/1': { status: 301, headers: { location: '/2' } },
          'https://acme.com/2': { status: 301, headers: { location: '/3' } },
          'https://acme.com/3': { status: 301, headers: { location: '/4' } },
          'https://acme.com/4': img,
        },
        dns,
      );
      expect(await reason(guardedGet('https://acme.com/1', opts(), deps(w)))).toBe('too_many_redirects');
    });

    it('rejects redirects to another domain, to http, to private-resolving hosts, and without Location', async () => {
      const mk = (loc?: string) => mockWorld({ 'https://acme.com/a': { status: 302, headers: loc ? { location: loc } : {} } }, dns);
      expect(await reason(guardedGet('https://acme.com/a', opts(), deps(mk('https://evil.com/x'))))).toBe('cross_domain');
      expect(await reason(guardedGet('https://acme.com/a', opts(), deps(mk('http://acme.com/x'))))).toBe('not_https');
      expect(await reason(guardedGet('https://acme.com/a', opts(), deps(mk('https://internal.acme.com/x'))))).toBe('private_ip');
      expect(await reason(guardedGet('https://acme.com/a', opts(), deps(mk('https://169.254.169.254/latest'))))).toBe('bad_url');
      expect(await reason(guardedGet('https://acme.com/a', opts(), deps(mk())))).toBe('bad_redirect');
    });
  });

  describe('body policy', () => {
    const dns = { 'acme.com': PUB };
    it('rejects non-2xx', async () => {
      const w = mockWorld({ 'https://acme.com/a.png': { status: 404 } }, dns);
      expect(await reason(guardedGet('https://acme.com/a.png', opts(), deps(w)))).toBe('http_status');
    });
    it.each(['image/svg+xml', 'text/html', 'image/gif', 'application/octet-stream', ''])('rejects content-type %j', async (ct) => {
      const w = mockWorld({ 'https://acme.com/a.png': { headers: ct ? { 'content-type': ct } : {}, body: 'x' } }, dns);
      expect(await reason(guardedGet('https://acme.com/a.png', opts(), deps(w)))).toBe('bad_content_type');
    });
    it('rejects declared content-length over the cap without reading', async () => {
      const w = mockWorld({ 'https://acme.com/a.png': { headers: { 'content-type': 'image/png', 'content-length': '999999' }, body: 'x' } }, dns);
      expect(await reason(guardedGet('https://acme.com/a.png', opts(), deps(w)))).toBe('too_large');
    });
    it('aborts a streamed body that lies about (or omits) content-length', async () => {
      let pulled = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          pulled += 1;
          c.enqueue(new Uint8Array(64 * 1024));
          if (pulled > 100) c.close();
        },
      });
      const w = mockWorld({ 'https://acme.com/a.png': { headers: { 'content-type': 'image/png', 'content-length': '10' }, body: stream } }, dns);
      expect(await reason(guardedGet('https://acme.com/a.png', opts(), deps(w)))).toBe('too_large');
      expect(pulled).toBeLessThan(10);
    });
    it('accepts a body of exactly the cap', async () => {
      const w = mockWorld({ 'https://acme.com/a.png': { headers: { 'content-type': 'image/png' }, body: Buffer.alloc(1000) } }, dns);
      expect((await guardedGet('https://acme.com/a.png', opts({ maxBytes: 1000 }), deps(w))).body.length).toBe(1000);
    });
    it('truncate mode returns the first maxBytes instead of rejecting', async () => {
      const w = mockWorld({ 'https://acme.com/': { headers: { 'content-type': 'text/html' }, body: Buffer.alloc(5000, 97) } }, dns);
      const r = await guardedGet('https://acme.com/', opts({ maxBytes: 1000, allowedTypes: ['text/html'], truncate: true }), deps(w));
      expect(r.body.length).toBe(1000);
    });
    it('maps network errors and aborts to network', async () => {
      const deps2: GuardDeps = { lookup: async () => PUB, fetch: async () => { throw new Error('boom'); } };
      expect(await reason(guardedGet('https://acme.com/a.png', opts(), deps2))).toBe('network');
    });
  });
});
