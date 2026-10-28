import { describe, expect, it } from 'vitest';
import { extractInThread, nodeSupportsExtraction } from '../src/resume/extract/thread';
import * as fx from './fixtures/generate-resume-fixtures';
import { flateBombPdf } from './fixtures/flate-bomb';
import { MAX_BYTES } from '../src/resume/extract/limits';

describe('extractInThread', () => {
  it('extracts a PDF in a fresh worker', async () => {
    const r = await extractInThread(fx.textPdf());
    if ('rejected' in r) throw new Error(`unexpected ${r.rejected}`);
    expect(r.text).toContain('Asha Example');
  });
  it('extracts a DOCX in a fresh worker', async () => {
    const r = await extractInThread(fx.normalDocx());
    if ('rejected' in r) throw new Error(`unexpected ${r.rejected}`);
    expect(r.kind).toBe('docx');
  });
  it('passes rejection codes through', async () => {
    expect(await extractInThread(fx.fourPagePdf())).toEqual({ rejected: 'too_many_pages' });
    expect(await extractInThread(fx.xxeDocx())).toEqual({ rejected: 'doctype' });
  });
  it('does not detach or consume the caller buffer', async () => {
    const bytes = fx.textPdf();
    const len = bytes.length;
    await extractInThread(bytes);
    expect(bytes.length).toBe(len);
  });
  it('terminates and reports timeout when the wall clock expires', async () => {
    const r = await extractInThread(fx.textPdf(), { timeoutMs: 1 });
    expect(r).toEqual({ rejected: 'timeout' });
  });
  it('runs independent jobs concurrently without shared state', async () => {
    const rs = await Promise.all([
      extractInThread(fx.textPdf()),
      extractInThread(fx.normalDocx()),
      extractInThread(fx.imageOnlyPdf()),
    ]);
    expect(rs.map((r: Awaited<ReturnType<typeof extractInThread>>) => ('rejected' in r ? r.rejected : r.kind))).toEqual(['pdf', 'docx', 'pdf']);
  });

  it('gates size and magic bytes in the parent before any copy or child is started', async () => {
    const big = new Uint8Array(MAX_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const slice = big.slice.bind(big);
    let copied = false;
    big.slice = ((...a: Parameters<Uint8Array['slice']>) => {
      copied = true;
      return slice(...a);
    }) as Uint8Array['slice'];
    expect(await extractInThread(big)).toEqual({ rejected: 'too_large' });
    expect(copied).toBe(false);
    expect(await extractInThread(new Uint8Array([1, 2, 3]))).toEqual({ rejected: 'bad_magic' });
  });

  it('survives a Flate bomb: the child is killed, the caller keeps running', async () => {
    const bomb = await flateBombPdf(1024);
    expect(bomb.length).toBeLessThan(MAX_BYTES);
    const before = process.memoryUsage().rss;
    const r = await extractInThread(bomb, { maxRssMb: 400, timeoutMs: 20_000 });
    expect('rejected' in r).toBe(true);
    // The parent never held the inflated data.
    expect(process.memoryUsage().rss - before).toBeLessThan(300 * 1024 * 1024);
    // A normal job still works afterwards.
    const ok = await extractInThread(fx.textPdf());
    expect('rejected' in ok).toBe(false);
  }, 60_000);

  it('detects supported Node versions', () => {
    expect(nodeSupportsExtraction('20.11.0')).toBe(false);
    expect(nodeSupportsExtraction('22.17.9')).toBe(false);
    expect(nodeSupportsExtraction('22.18.0')).toBe(true);
    expect(nodeSupportsExtraction('23.5.0')).toBe(false);
    expect(nodeSupportsExtraction('23.6.0')).toBe(true);
    expect(nodeSupportsExtraction('24.14.0')).toBe(true);
  });
});
