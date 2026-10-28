/** Synthetic FlateDecode bomb PDF: a few hundred KB on disk, hundreds of MB once inflated. */
import { createDeflate } from 'node:zlib';

async function deflateZeros(totalMb: number): Promise<Buffer> {
  const d = createDeflate({ level: 9 });
  const parts: Buffer[] = [];
  d.on('data', (c: Buffer) => parts.push(c));
  const done = new Promise<void>((res, rej) => {
    d.on('end', res);
    d.on('error', rej);
  });
  const chunk = Buffer.alloc(8 * 1024 * 1024);
  for (let i = 0; i < totalMb / 8; i++) {
    if (!d.write(chunk)) await new Promise((r) => d.once('drain', r));
  }
  d.end();
  await done;
  return Buffer.concat(parts);
}

export async function flateBombPdf(inflatedMb: number): Promise<Uint8Array> {
  const z = await deflateZeros(inflatedMb);
  const head = (n: number, body: string) => Buffer.from(`${n} 0 obj\n${body}\nendobj\n`, 'latin1');
  const bufs: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let pos = bufs[0]!.length;
  const add = (b: Buffer) => {
    offsets.push(pos);
    bufs.push(b);
    pos += b.length;
  };
  add(head(1, '<< /Type /Catalog /Pages 2 0 R >>'));
  add(head(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  add(head(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>'));
  add(
    Buffer.concat([
      Buffer.from(`4 0 obj\n<< /Filter /FlateDecode /Length ${z.length} >>\nstream\n`, 'latin1'),
      z,
      Buffer.from('\nendstream\nendobj\n', 'latin1'),
    ]),
  );
  let tail = `xref\n0 5\n0000000000 65535 f \n`;
  for (const o of offsets) tail += `${String(o).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  bufs.push(Buffer.from(tail, 'latin1'));
  return new Uint8Array(Buffer.concat(bufs));
}
