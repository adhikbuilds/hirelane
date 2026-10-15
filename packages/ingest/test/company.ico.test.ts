import { describe, expect, it } from 'vitest';
import { extractIcoImage } from '../src/company/ico';
import { icoWithBmp32, icoWithPng, pngOf } from './company.helpers';

describe('extractIcoImage', () => {
  it('returns the embedded PNG', async () => {
    const png = await pngOf(48);
    const r = extractIcoImage(icoWithPng(png, 48));
    expect(r).toEqual({ kind: 'png', data: png });
  });
  it('decodes a 32bpp BMP entry to raw RGBA', () => {
    const r = extractIcoImage(icoWithBmp32(32, [10, 20, 30, 255]));
    expect(r?.kind).toBe('rgba');
    if (r?.kind !== 'rgba') throw new Error();
    expect([r.width, r.height]).toEqual([32, 32]);
    expect([...r.data.subarray(0, 4)]).toEqual([10, 20, 30, 255]);
    expect(r.data.length).toBe(32 * 32 * 4);
  });
  it('returns null for truncated, empty or non-ico data and for non-32bpp BMP', () => {
    expect(extractIcoImage(Buffer.alloc(0))).toBeNull();
    expect(extractIcoImage(Buffer.from([0, 0, 1, 0, 5, 0]))).toBeNull();
    expect(extractIcoImage(Buffer.from('GIF89a....'))).toBeNull();
    const bmp = icoWithBmp32(32, [1, 2, 3, 4]);
    bmp.writeUInt16LE(8, 22 + 14);
    expect(extractIcoImage(bmp)).toBeNull();
  });
  it('rejects entries whose offset/size point outside the buffer', () => {
    const b = icoWithPng(Buffer.from('x'), 16);
    b.writeUInt32LE(9999, 14);
    expect(extractIcoImage(b)).toBeNull();
  });
  it('rejects absurd BMP dimensions', () => {
    const b = icoWithBmp32(32, [0, 0, 0, 255]);
    b.writeInt32LE(100000, 22 + 4);
    expect(extractIcoImage(b)).toBeNull();
  });
});
