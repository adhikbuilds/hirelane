import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { discoverIcons, fetchCompanyLogo } from '../src/company/logo';
import { icoWithBmp32, icoWithPng, mockWorld, pngOf } from './company.helpers';

const PUB = { 'acme.com': ['93.184.216.34'], 'www.acme.com': ['93.184.216.34'] };
const html = (body: string) => ({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: `<html><head>${body}</head></html>` });
const img = (b: Buffer, type = 'image/png') => ({ headers: { 'content-type': type }, body: b });

describe('discoverIcons', () => {
  it('prefers apple-touch-icon, then larger icons; resolves relative URLs; skips svg and mask-icon', () => {
    const urls = discoverIcons(
      `<link rel="icon" href="/s.png" sizes="16x16"><link rel="mask-icon" href="/m.svg">
       <link rel="shortcut icon" href="fav.ico"><link rel="icon" type="image/svg+xml" href="/i.svg">
       <LINK REL="Apple-Touch-Icon" HREF='/at.png' sizes="180x180"><link rel="icon" href="/big.png" sizes="192x192">`,
      'https://acme.com/en/',
    );
    expect(urls).toEqual(['https://acme.com/at.png', 'https://acme.com/big.png', 'https://acme.com/s.png', 'https://acme.com/en/fav.ico']);
  });
  it('ignores junk and non-http(s) hrefs', () => {
    expect(discoverIcons('<link rel="icon" href="data:image/png;base64,AAA"><link rel="icon" href="javascript:1"><link rel="icon">', 'https://acme.com/')).toEqual([]);
    expect(discoverIcons('', 'https://acme.com/')).toEqual([]);
  });
});

describe('fetchCompanyLogo', () => {
  it('uses the homepage apple-touch-icon and re-encodes to a 64x64 PNG', async () => {
    const big = await pngOf(180);
    const w = mockWorld({ 'https://acme.com/': html('<link rel="apple-touch-icon" href="/touch.png">'), 'https://acme.com/touch.png': img(big) }, PUB);
    const r = await fetchCompanyLogo('Acme.com', { fetch: w.fetch, lookup: w.lookup });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = await sharp(r.png).metadata();
    expect([m.format, m.width, m.height]).toEqual(['png', 64, 64]);
    expect(r.sourceUrl).toBe('https://acme.com/touch.png');
  });

  it('keeps aspect ratio by padding non-square icons', async () => {
    const w = mockWorld({ 'https://acme.com/': html('<link rel="icon" href="/w.png">'), 'https://acme.com/w.png': img(await pngOf(120, 60)) }, PUB);
    const r = await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup });
    if (!r.ok) throw new Error(r.reason);
    const m = await sharp(r.png).metadata();
    expect([m.width, m.height]).toEqual([64, 64]);
  });

  it('strips metadata (text chunks) when re-encoding', async () => {
    const withExif = await sharp(await pngOf(64)).withMetadata({ exif: { IFD0: { Copyright: 'secret-marker' } } }).png().toBuffer();
    const w = mockWorld({ 'https://acme.com/': html('<link rel="icon" href="/a.png">'), 'https://acme.com/a.png': img(withExif) }, PUB);
    const r = await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup });
    if (!r.ok) throw new Error(r.reason);
    expect(r.png.includes('secret-marker')).toBe(false);
  });

  it('falls back to /favicon.ico (embedded PNG) when the homepage has no icon links', async () => {
    const w = mockWorld({ 'https://acme.com/': html(''), 'https://acme.com/favicon.ico': img(icoWithPng(await pngOf(48), 48), 'image/x-icon') }, PUB);
    const r = await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup });
    expect(r.ok).toBe(true);
  });

  it('decodes a BMP-based ico (vnd.microsoft.icon)', async () => {
    const w = mockWorld({ 'https://acme.com/': html(''), 'https://acme.com/favicon.ico': img(icoWithBmp32(32, [200, 10, 10, 255]), 'image/vnd.microsoft.icon') }, PUB);
    const r = await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup });
    if (!r.ok) throw new Error(r.reason);
    const { data } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
    expect(data[(32 * 64 + 32) * 4]).toBeGreaterThan(150); // red channel mid-image
  });

  it('works when the homepage itself fails (404) by trying well-known paths', async () => {
    const w = mockWorld({ 'https://acme.com/apple-touch-icon.png': img(await pngOf(180)) }, PUB);
    expect((await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup })).ok).toBe(true);
  });

  it('never fetches an icon hosted off the company domain', async () => {
    const w = mockWorld(
      { 'https://acme.com/': html('<link rel="icon" href="https://cdn.evil.net/x.png"><link rel="apple-touch-icon" href="//evil.com/y.png">') },
      PUB,
    );
    const r = await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup });
    expect(r.ok).toBe(false);
    expect(w.calls.some((u) => u.includes('evil'))).toBe(false);
  });

  it('rejects SVG icons (by link, by header, never sanitised)', async () => {
    const w = mockWorld(
      { 'https://acme.com/': html('<link rel="icon" href="/a.png">'), 'https://acme.com/a.png': img(Buffer.from('<svg onload=alert(1)/>'), 'image/svg+xml') },
      PUB,
    );
    expect((await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup })).ok).toBe(false);
  });

  it('rejects content whose bytes do not match the declared type', async () => {
    const w = mockWorld({ 'https://acme.com/': html('<link rel="icon" href="/a.png">'), 'https://acme.com/a.png': img(Buffer.from('<html>not a png</html>')) }, PUB);
    const r = await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup });
    expect(r).toMatchObject({ ok: false });
  });

  it('rejects icons smaller than 32px on the short side', async () => {
    const w = mockWorld({ 'https://acme.com/': html('<link rel="icon" href="/a.png">'), 'https://acme.com/a.png': img(await pngOf(16)) }, PUB);
    expect((await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup })).ok).toBe(false);
  });

  it('rejects a decompression bomb (tiny file, huge declared dimensions)', async () => {
    const bomb = await sharp({ create: { width: 12000, height: 12000, channels: 3, background: '#000' } }).grayscale().png({ compressionLevel: 9, palette: true }).toBuffer();
    expect(bomb.length).toBeLessThan(200 * 1024); // premise of the test
    const w = mockWorld({ 'https://acme.com/': html('<link rel="icon" href="/a.png">'), 'https://acme.com/a.png': img(bomb) }, PUB);
    const r = await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup });
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r.ok ? '' : r.attempts)).toContain('too_many_pixels');
  });

  it('tries the next candidate when one is rejected', async () => {
    const w = mockWorld(
      { 'https://acme.com/': html('<link rel="apple-touch-icon" href="/bad.png"><link rel="icon" href="/good.png" sizes="64x64">'), 'https://acme.com/bad.png': { status: 500 }, 'https://acme.com/good.png': img(await pngOf(64)) },
      PUB,
    );
    const r = await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup });
    if (!r.ok) throw new Error(r.reason);
    expect(r.sourceUrl).toBe('https://acme.com/good.png');
  });

  it('returns ok:false with reasons for invalid domains without touching the network', async () => {
    const w = mockWorld({}, {});
    for (const d of [null, '', '127.0.0.1', 'localhost', 'a.com/x']) {
      expect(await fetchCompanyLogo(d, { fetch: w.fetch, lookup: w.lookup })).toMatchObject({ ok: false, reason: 'no_domain' });
    }
    expect(w.calls).toEqual([]);
  });

  it('a private-resolving domain yields ok:false and zero fetches', async () => {
    const w = mockWorld({}, { 'acme.com': ['10.0.0.1'] });
    const r = await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup });
    expect(r.ok).toBe(false);
    expect(w.calls).toEqual([]);
  });

  it('caps the number of candidate fetches', async () => {
    const links = Array.from({ length: 30 }, (_, i) => `<link rel="icon" href="/i${i}.png">`).join('');
    const w = mockWorld({ 'https://acme.com/': html(links) }, PUB);
    await fetchCompanyLogo('acme.com', { fetch: w.fetch, lookup: w.lookup });
    expect(w.calls.length).toBeLessThanOrEqual(1 + 8);
  });
});
