import sharp from 'sharp';
import type { GuardFetch, Lookup } from '../src/company/logo-fetch';

export async function pngOf(w: number, h = w, color = { r: 20, g: 120, b: 200, alpha: 1 }): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toBuffer();
}

/** ICO container whose single entry is an embedded PNG. */
export function icoWithPng(png: Buffer, w: number): Buffer {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head[6] = w >= 256 ? 0 : w;
  head[7] = w >= 256 ? 0 : w;
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

/** ICO whose single entry is a 32bpp BMP DIB (BGRA, bottom-up, no AND mask needed for alpha). */
export function icoWithBmp32(w: number, rgba: [number, number, number, number]): Buffer {
  const dibHeader = Buffer.alloc(40);
  dibHeader.writeUInt32LE(40, 0);
  dibHeader.writeInt32LE(w, 4);
  dibHeader.writeInt32LE(w * 2, 8); // height doubled: XOR + AND mask
  dibHeader.writeUInt16LE(1, 12);
  dibHeader.writeUInt16LE(32, 14);
  const px = Buffer.alloc(w * w * 4);
  for (let i = 0; i < w * w; i++) {
    px[i * 4] = rgba[2];
    px[i * 4 + 1] = rgba[1];
    px[i * 4 + 2] = rgba[0];
    px[i * 4 + 3] = rgba[3];
  }
  const and = Buffer.alloc(Math.ceil(w / 32) * 4 * w);
  const dib = Buffer.concat([dibHeader, px, and]);
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head[6] = w;
  head[7] = w;
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(dib.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, dib]);
}

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: Buffer | string | ReadableStream<Uint8Array>;
}

export function mockWorld(routes: Record<string, Reply | (() => Reply)>, dns: Record<string, string[]> = {}) {
  const calls: string[] = [];
  const lookups: string[] = [];
  const fetch: GuardFetch = async (url, init) => {
    calls.push(url);
    expectManual(init.redirect);
    const r = routes[url];
    if (!r) return new Response('nf', { status: 404 });
    const v = typeof r === 'function' ? r() : r;
    return new Response((v.body ?? '') as never, { status: v.status ?? 200, headers: v.headers ?? {} });
  };
  const lookup: Lookup = async (host) => {
    lookups.push(host);
    const a = dns[host];
    if (!a) throw new Error(`ENOTFOUND ${host}`);
    return a;
  };
  return { fetch, lookup, calls, lookups };
}

function expectManual(r: unknown) {
  if (r !== 'manual') throw new Error('fetch must use redirect: manual');
}
