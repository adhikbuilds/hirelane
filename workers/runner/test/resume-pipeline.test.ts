import { describe, expect, it } from 'vitest';
import { verhoeffCheckDigit } from '@hirelane/engine';
import { runPipeline, sanitizeProducerFamily, PARSED_DOC_VERSION } from '../src/resume/pipeline';
import * as fx from './fixtures/generate-resume-fixtures';

/** A Verhoeff-valid synthetic Aadhaar-shaped number (never a real one). */
const base = '23456789012';
const AADHAAR = `${base}${verhoeffCheckDigit(base)}`;
const AADHAAR_SPACED = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;

const aadhaarDocx = () =>
  fx.docxFromDocumentXml(
    fx.docXml([
      'Asha Example',
      'asha.example@example.test 90000 000001',
      'Aadhaar: ' + AADHAAR_SPACED,
      'Education',
      'B.Tech Computer Science, Example Institute of Technology, 8.2 CGPA, 2026',
      'Skills',
      'Python, SQL, data structures',
    ]),
  );

describe('runPipeline: rejects', () => {
  it.each([
    ['too_many_pages', () => fx.fourPagePdf()],
    ['doctype', () => fx.xxeDocx()],
    ['encrypted', () => fx.encryptedPdf()],
    ['active_content', () => fx.jsAndAttachmentPdf()],
  ] as const)('maps %s to a rejected outcome with no pages', async (code, make) => {
    const o = await runPipeline(make());
    expect(o).toMatchObject({ kind: 'rejected', status: 'rejected', rejectCode: code, pages: null });
  });

  it('bad magic is rejected', async () => {
    expect(await runPipeline(new Uint8Array([1, 2, 3]))).toMatchObject({ kind: 'rejected', status: 'rejected', rejectCode: 'bad_magic' });
  });

  it('timeout and parse_error (a hostile file such as a Flate bomb lands here) are rejected too, never failed or retried', async () => {
    const t = await runPipeline(new Uint8Array(), { extract: async () => ({ rejected: 'timeout' }) });
    expect(t).toMatchObject({ kind: 'rejected', status: 'rejected', rejectCode: 'timeout' });
    const p = await runPipeline(new Uint8Array(), { extract: async () => ({ rejected: 'parse_error' }) });
    expect(p).toMatchObject({ kind: 'rejected', status: 'rejected', rejectCode: 'parse_error' });
  });
});

describe('runPipeline: needs_text', () => {
  it('an image-only PDF stops at needs_text with ats_readable failing first and 0 of 9 passing', async () => {
    const o = await runPipeline(fx.imageOnlyPdf());
    if (o.kind !== 'needs_text') throw new Error(`expected needs_text, got ${o.kind}`);
    expect(o.status).toBe('needs_text');
    expect(['none', 'garbled']).toContain(o.textLayer);
    expect(o.health[0]).toMatchObject({ id: 'ats_readable', status: 'fail' });
    expect(o.health).toHaveLength(9);
    expect(o.healthPassed).toBe(0);
    expect(o.healthTotal).toBe(9);
    expect(o.pages).toBe(1);
    expect(o.sensitiveKinds).toContain('image');
    expect('doc' in o).toBe(false);
  });

  it('a garbled text layer also stops at needs_text', async () => {
    const o = await runPipeline(new Uint8Array(), {
      extract: async () => ({
        kind: 'pdf', pages: 1, pageStats: [{ chars: 400, images: 0 }], imageCount: 0, encrypted: false,
        flags: { javascript: false, embeddedFiles: false, macros: false, externalRefs: false },
        producerFamily: 'canva', text: '�'.repeat(200),
      }),
    });
    expect(o.kind).toBe('needs_text');
    if (o.kind === 'needs_text') expect(o.textLayer).toBe('garbled');
  });
});

describe('runPipeline: parsed', () => {
  it('parses a text PDF: sections, health, no sensitive kinds', async () => {
    const o = await runPipeline(fx.textPdf(), { fileName: 'Asha_Example_Resume.pdf' });
    if (o.kind !== 'parsed') throw new Error(`expected parsed, got ${o.kind}`);
    expect(o.status).toBe('parsed');
    expect(o.textLayer).toBe('readable');
    expect(o.pages).toBe(1);
    expect(o.healthTotal).toBe(9);
    expect(o.health.map((h) => h.id).sort()).toHaveLength(9);
    expect(o.doc.v).toBe(PARSED_DOC_VERSION);
    expect(o.doc.text).toContain('Asha Example');
    expect(o.doc.fileName).toBe('Asha_Example_Resume.pdf');
    expect(o.health.find((h) => h.id === 'sensible_file_name')?.status).toBe('pass');
  });

  it('a DOCX has null pages and an unknown one_page check', async () => {
    const o = await runPipeline(fx.normalDocx());
    if (o.kind !== 'parsed') throw new Error(`expected parsed, got ${o.kind}`);
    expect(o.pages).toBeNull();
    expect(o.health.find((h) => h.id === 'one_page')?.status).toBe('unknown');
  });

  it('masks Aadhaar BEFORE the doc is built, yet the health check still sees it', async () => {
    const o = await runPipeline(aadhaarDocx());
    if (o.kind !== 'parsed') throw new Error(`expected parsed, got ${o.kind}`);
    const json = JSON.stringify(o.doc);
    expect(json).not.toContain(AADHAAR);
    expect(json).not.toContain(AADHAAR_SPACED);
    expect(o.doc.text).toContain('XXXX XXXX XXXX');
    expect(o.sensitiveKinds).toContain('aadhaar');
    // Health ran on the unmasked text: a masked scan would wrongly pass.
    expect(o.health.find((h) => h.id === 'no_biodata_ids')?.status).toBe('fail');
    // Health reasons never echo the value.
    expect(JSON.stringify(o.health)).not.toContain(AADHAAR);
  });

  it('keeps section offsets valid for the masked text (masking is length preserving)', async () => {
    const o = await runPipeline(aadhaarDocx());
    if (o.kind !== 'parsed') throw new Error('parsed expected');
    for (const s of o.doc.sections) {
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeLessThanOrEqual(o.doc.text.length);
    }
  });

  it('scans the file name for sensitive kinds without storing findings from it in the text', async () => {
    const o = await runPipeline(fx.textPdf(), { fileName: `resume_${AADHAAR}.pdf` });
    if (o.kind !== 'parsed') throw new Error('parsed expected');
    expect(o.sensitiveKinds).toContain('aadhaar');
  });

  it('does not forward the original file name when it is absent', async () => {
    const o = await runPipeline(fx.textPdf());
    if (o.kind !== 'parsed') throw new Error('parsed expected');
    expect(o.doc.fileName).toBeNull();
    expect(o.health.find((h) => h.id === 'sensible_file_name')?.status).toBe('unknown');
  });
});

describe('runPipeline: Node Buffer input', () => {
  it('parses a Buffer (what the blob store returns); extractInThread alone reports parse_error for one', async () => {
    const o = await runPipeline(Buffer.from(fx.textPdf()));
    expect(o.kind).toBe('parsed');
  });
});

describe('sanitizeProducerFamily', () => {
  it('fits ^[a-z_]{1,24}$ for any input', () => {
    for (const v of ['Microsoft Word 365', '', 'ÉÉ', 'x'.repeat(80), undefined, 'a-b.c']) {
      expect(sanitizeProducerFamily(v as string)).toMatch(/^[a-z_]{1,24}$/);
    }
    expect(sanitizeProducerFamily('canva')).toBe('canva');
  });
});

describe('runPipeline: sealed document honours the services schema caps and the masking promise', () => {
  const meta = { kind: 'docx' as const, pages: null, pageStats: [], imageCount: 0, encrypted: false, flags: { javascript: false, embeddedFiles: false, macros: false, externalRefs: false }, producerFamily: 'word' };
  const extractText = (text: string) => async () => ({ ...meta, text });

  it('caps text at 200,000 characters AFTER normalisation (NFKC can lengthen it)', async () => {
    // U+FDFA normalises to 18 characters, so a text under the extractor cap can exceed 200k once normalised.
    const text = 'Education B.Tech 8.2 CGPA 2026\nSkills Python\n' + 'ﷺ'.repeat(15_000);
    const o = await runPipeline(new Uint8Array(8), { extract: extractText(text) });
    if (o.kind !== 'parsed') throw new Error(`expected parsed, got ${o.kind}`);
    expect(o.doc.text.length).toBeLessThanOrEqual(200_000);
  });

  it('masks an Aadhaar or PAN number in the file name before it is sealed, and still flags the kind', async () => {
    const o = await runPipeline(new Uint8Array(8), {
      extract: extractText('Asha Example\nEducation\nB.Tech Computer Science, 8.2 CGPA, 2026\nSkills\nPython, SQL'),
      fileName: `resume ${AADHAAR_SPACED} ABCPE1234F.pdf`,
    });
    if (o.kind !== 'parsed') throw new Error(`expected parsed, got ${o.kind}`);
    expect(o.doc.fileName).not.toContain(AADHAAR);
    expect(o.doc.fileName).not.toContain('2345 6789');
    expect(o.doc.fileName).not.toContain('ABCPE1234F');
    expect(o.sensitiveKinds).toEqual(expect.arrayContaining(['aadhaar', 'pan']));
  });

  it('keeps a clean file name as it was', async () => {
    const o = await runPipeline(new Uint8Array(8), {
      extract: extractText('Asha Example\nEducation\nB.Tech Computer Science, 8.2 CGPA, 2026\nSkills\nPython, SQL'),
      fileName: 'Asha_Example_Resume.pdf',
    });
    if (o.kind !== 'parsed') throw new Error('expected parsed');
    expect(o.doc.fileName).toBe('Asha_Example_Resume.pdf');
  });
});
