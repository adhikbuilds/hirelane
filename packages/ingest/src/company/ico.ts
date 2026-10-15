/**
 * Minimal ICO reader. libvips (sharp) cannot decode .ico, so pull out the best entry ourselves:
 * an embedded PNG is returned as-is, a 32bpp BMP entry is converted to raw RGBA. Anything else gives null.
 */

export type IcoImage = { kind: 'png'; data: Buffer } | { kind: 'rgba'; data: Buffer; width: number; height: number };

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_ENTRIES = 64;
const MAX_BMP_SIDE = 512;

export function extractIcoImage(buf: Buffer): IcoImage | null {
  if (buf.length < 22 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const count = buf.readUInt16LE(4);
  if (count === 0 || count > MAX_ENTRIES || 6 + count * 16 > buf.length) return null;
  const entries: { w: number; size: number; offset: number }[] = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const size = buf.readUInt32LE(e + 8);
    const offset = buf.readUInt32LE(e + 12);
    if (offset >= buf.length || size === 0 || offset + size > buf.length) continue;
    entries.push({ w: buf[e] || 256, size, offset });
  }
  entries.sort((a, b) => b.w - a.w);
  for (const e of entries) {
    const data = buf.subarray(e.offset, e.offset + e.size);
    if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIG)) return { kind: 'png', data: Buffer.from(data) };
    const bmp = decodeBmp32(data);
    if (bmp) return bmp;
  }
  return null;
}

function decodeBmp32(d: Buffer): IcoImage | null {
  if (d.length < 40 || d.readUInt32LE(0) < 40) return null;
  const width = d.readInt32LE(4);
  const height = Math.abs(d.readInt32LE(8)) / 2; // XOR bitmap + AND mask stacked
  const bpp = d.readUInt16LE(14);
  const compression = d.readUInt32LE(16);
  if (bpp !== 32 || (compression !== 0 && compression !== 3)) return null;
  if (!Number.isInteger(height) || width < 1 || height < 1 || width > MAX_BMP_SIDE || height > MAX_BMP_SIDE) return null;
  const start = d.readUInt32LE(0);
  const need = width * height * 4;
  if (start + need > d.length) return null;
  const topDown = d.readInt32LE(8) < 0;
  const out = Buffer.alloc(need);
  for (let y = 0; y < height; y++) {
    const srcRow = start + (topDown ? y : height - 1 - y) * width * 4;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const o = (y * width + x) * 4;
      out[o] = d[s + 2]!;
      out[o + 1] = d[s + 1]!;
      out[o + 2] = d[s]!;
      out[o + 3] = d[s + 3]!;
    }
  }
  return { kind: 'rgba', data: out, width, height };
}
