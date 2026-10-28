/**
 * Test-time resume fixture generator (S1.12). Nothing here is committed as a binary.
 * Content is synthetic only: no real names, emails or IDs.
 * PDFs are hand-written (pdf-lib is not in the lockfile); DOCX files are built with fflate.
 */
import { zipSync, strToU8 } from 'fflate';


// ---------------------------------------------------------------- PDF

/** Escape a string for a PDF literal string. */
function pdfEsc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

interface PdfBuild {
  /** Objects 1..n in order; the string between "N 0 obj" and "endobj". */
  objects: string[];
  root: number;
  trailerExtra?: string;
}

/** Serialise objects into a PDF with a correct xref table. ASCII only (latin1 bytes). */
function buildPdf({ objects, root, trailerExtra = '' }: PdfBuild): Uint8Array {
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R ${trailerExtra} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

function stream(dict: string, data: string): string {
  return `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
}

interface PagesOpts {
  /** One entry per page: text lines, or 'image' for a page that only paints an image. */
  pages: Array<string[] | 'image'>;
  /** Extra entries for the catalog dictionary. */
  catalogExtra?: string;
  /** Extra objects appended after the standard ones; first extra object is number `extraStart`. */
  extra?: string[];
  trailerExtra?: string;
  producer?: string;
}

function pdfWithPages(opts: PagesOpts): Uint8Array {
  const n = opts.pages.length;
  // 1 catalog, 2 pages, 3 font, 4 image, 5 info, then per page: page obj + content obj, then extras.
  const kids = opts.pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ');
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R ${opts.catalogExtra ?? ''} >>`,
    `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    stream(
      '/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode',
      '80>',
    ),
    `<< /Producer (${pdfEsc(opts.producer ?? 'Synthetic Test Writer')}) /Title (Synthetic) >>`,
  ];
  opts.pages.forEach((page, i) => {
    const contentNo = 7 + i * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNo} 0 R ` +
        `/Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> >>`,
    );
    let content: string;
    if (page === 'image') {
      content = 'q 200 0 0 200 72 500 cm /Im1 Do Q';
    } else {
      content = 'BT /F1 12 Tf 14 TL 72 720 Td\n';
      for (const line of page) content += `(${pdfEsc(line)}) Tj T*\n`;
      content += 'ET';
    }
    objects.push(stream('', content));
  });
  if (opts.extra) objects.push(...opts.extra);
  return buildPdf({
    objects,
    root: 1,
    trailerExtra: `/Info 5 0 R ${opts.trailerExtra ?? ''}`,
  });
}

export const SYNTHETIC_LINES = [
  'Asha Example',
  'asha.example@example.invalid',
  'B.Tech Computer Science, Example Institute of Technology, 2026',
  'Skills: Python, SQL, data structures',
  'Project: Library tracker with REST API and tests',
];

/** One page of real text, produced by a Word-like producer string. */
export function textPdf(): Uint8Array {
  return pdfWithPages({ pages: [SYNTHETIC_LINES], producer: 'Microsoft Word for Microsoft 365' });
}

/** One page that only paints an image: 0 text characters, 1 image. */
export function imageOnlyPdf(): Uint8Array {
  return pdfWithPages({ pages: ['image'], producer: 'Canva' });
}

/** Four text pages, one over the 3-page limit. */
export function fourPagePdf(): Uint8Array {
  return pdfWithPages({
    pages: [SYNTHETIC_LINES, SYNTHETIC_LINES, SYNTHETIC_LINES, SYNTHETIC_LINES],
  });
}

/** Exactly three text pages (the limit is inclusive). */
export function threePagePdf(): Uint8Array {
  return pdfWithPages({ pages: [SYNTHETIC_LINES, SYNTHETIC_LINES, SYNTHETIC_LINES] });
}

/** OpenAction JavaScript plus an embedded file. Neither may be executed or extracted. */
export function jsAndAttachmentPdf(): Uint8Array {
  // Extra objects start at number 6 + 2*pages = 8 for one page.
  return pdfWithPages({
    pages: [SYNTHETIC_LINES],
    catalogExtra: '/OpenAction 8 0 R /Names << /EmbeddedFiles << /Names [(note.txt) 10 0 R] >> >>',
    extra: [
      '<< /S /JavaScript /JS (app.alert\\(1\\);) >>',
      stream('/Type /EmbeddedFile', 'synthetic attachment body'),
      '<< /Type /Filespec /F (note.txt) /EF << /F 9 0 R >> >>',
    ],
  });
}

/** Structurally encrypted PDF (Standard handler with dummy O/U strings). */
export function encryptedPdf(): Uint8Array {
  const hex32 = '00'.repeat(32);
  return pdfWithPages({
    pages: [SYNTHETIC_LINES],
    extra: [`<< /Filter /Standard /V 1 /R 2 /O <${hex32}> /U <${hex32}> /P -4 >>`],
    trailerExtra: '/Encrypt 8 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]',
  });
}

// ---------------------------------------------------------------- DOCX

const CT_BASE =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>';

const CT_MACRO = CT_BASE.replace(
  'wordprocessingml.document.main+xml',
  'ms-word.document.macroEnabled.main+xml',
);

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function docXml(paragraphs: string[]): string {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><w:document ${W_NS}><w:body>${body}</w:body></w:document>`;
}

export const DOCX_PARAGRAPHS = [
  'Asha Example',
  'B.Tech Computer Science &amp; Engineering, 2026',
  'Skills: Python &#x26; SQL &lt;3 &#65;',
];

const CORE_XML =
  '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties ' +
  'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Synthetic</dc:title></cp:coreProperties>';

export type ZipFiles = Record<string, Uint8Array | string>;

/** Build a zip from name to content (string or bytes). Level 6 deflate by default. */
export function makeZip(files: ZipFiles, level: 0 | 6 | 9 = 6): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) input[k] = typeof v === 'string' ? strToU8(v) : v;
  return zipSync(input, { level });
}

function baseDocx(extra: ZipFiles = {}, documentXml?: string, contentTypes = CT_BASE): Uint8Array {
  return makeZip({
    '[Content_Types].xml': contentTypes,
    'word/document.xml': documentXml ?? docXml(DOCX_PARAGRAPHS),
    'docProps/core.xml': CORE_XML,
    ...extra,
  });
}

export function normalDocx(): Uint8Array {
  return baseDocx({
    'word/header1.xml': docXml(['Header Line']),
    'word/footer1.xml': docXml(['Footer Line']),
  });
}

/** DOCX with two media parts (counted as images) and an external hyperlink relationship. */
export function docxWithMedia(): Uint8Array {
  return baseDocx({
    'word/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
    'word/media/image2.jpg': new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]),
    'word/_rels/document.xml.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ' +
      'Target="https://example.invalid/profile" TargetMode="External"/></Relationships>',
  });
}

/** document.xml is 40 MB of one repeated byte: ratio far above 200 and size far above the caps. */
export function zipBombDocx(): Uint8Array {
  const big = new Uint8Array(40 * 1024 * 1024).fill(0x41);
  const head = strToU8(`<?xml version="1.0"?><w:document ${W_NS}><w:body><w:p><w:r><w:t>`);
  const tail = strToU8('</w:t></w:r></w:p></w:body></w:document>');
  const doc = new Uint8Array(head.length + big.length + tail.length);
  doc.set(head, 0);
  doc.set(big, head.length);
  doc.set(tail, head.length + big.length);
  return baseDocx({ 'word/document.xml': doc });
}

/** Overwrite the declared uncompressed sizes (local + central headers) so they lie. */
export function withLyingSizes(zip: Uint8Array, declared = 100): Uint8Array {
  const out = zip.slice();
  const dv = new DataView(out.buffer);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = dv.getUint32(i, true);
    if (sig === 0x04034b50 && i + 30 <= out.length) dv.setUint32(i + 22, declared, true);
    else if (sig === 0x02014b50 && i + 46 <= out.length) dv.setUint32(i + 24, declared, true);
  }
  return out;
}

/**
 * Highly random-looking (ratio about 4) text so a part exceeds a byte cap without tripping
 * the ratio check first. `bytes` is the uncompressed size.
 */
export function lowRatioDocx(bytes: number): Uint8Array {
  const alphabet = 'ACGT';
  const buf = new Uint8Array(bytes);
  let x = 123456789;
  for (let i = 0; i < bytes; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0; // deterministic LCG
    buf[i] = alphabet.charCodeAt((x >>> 16) & 3);
  }
  const head = strToU8(`<?xml version="1.0"?><w:document ${W_NS}><w:body><w:p><w:r><w:t>`);
  const tail = strToU8('</w:t></w:r></w:p></w:body></w:document>');
  const doc = new Uint8Array(head.length + buf.length + tail.length);
  doc.set(head, 0);
  doc.set(buf, head.length);
  doc.set(tail, head.length + buf.length);
  return baseDocx({ 'word/document.xml': doc });
}

/** XML external entity attempt. */
export function xxeDocx(): Uint8Array {
  const xml =
    '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>' +
    `<w:document ${W_NS}><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>`;
  return baseDocx({}, xml);
}

/** Macro-enabled document: vbaProject.bin plus the macroEnabled content type. */
export function docmDocx(): Uint8Array {
  return baseDocx({ 'word/vbaProject.bin': new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]) }, undefined, CT_MACRO);
}

/** Only the macroEnabled content type, no vbaProject.bin part. */
export function macroContentTypeOnlyDocx(): Uint8Array {
  return baseDocx({}, undefined, CT_MACRO);
}

/** document.xml carries an altChunk (embedded foreign content). */
export function altChunkDocx(): Uint8Array {
  const xml = `<?xml version="1.0"?><w:document ${W_NS}><w:body><w:altChunk r:id="rId9" xmlns:r="x"/></w:body></w:document>`;
  return baseDocx({}, xml);
}

/** A zip inside the docx. */
export function nestedArchiveDocx(): Uint8Array {
  const inner = makeZip({ 'a.txt': 'inner' });
  return baseDocx({ 'word/embeddings/inner.zip': inner });
}

/** Many tiny entries to exceed the 300 entry cap. */
export function manyEntriesDocx(count = 301): Uint8Array {
  const extra: ZipFiles = {};
  for (let i = 0; i < count; i++) extra[`customXml/item${i}.xml`] = '<a/>';
  return baseDocx(extra);
}

/** Build a docx from a custom document.xml (for text walk tests). */
export function docxFromDocumentXml(documentXml: string): Uint8Array {
  return baseDocx({}, documentXml);
}

