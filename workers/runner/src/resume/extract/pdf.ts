/**
 * PDF extraction via unpdf (bundled pdf.js). Hardened:
 * - isEvalSupported:false (not load-bearing: it is a no-op in this pdf.js build), no XFA, no system fonts, no worker fetch, no remote URLs.
 * - Document JavaScript is never run; embedded files are flagged from the raw bytes and never read.
 * - Encrypted files (any /Encrypt, including empty-user-password ones) are refused.
 * - Page count is checked before any text is extracted.
 */
import { getDocumentProxy, getResolvedPDFJS } from 'unpdf';
import type { ExtractResult } from './types';

export const MAX_PDF_PAGES = 3;

const IMAGE_OPS = [
  'paintImageXObject',
  'paintInlineImageXObject',
  'paintInlineImageXObjectGroup',
  'paintImageXObjectRepeat',
  'paintImageMaskXObject',
  'paintImageMaskXObjectGroup',
  'paintImageMaskXObjectRepeat',
  'paintJpegXObject',
];

/** Normalised producer family. Never returns the raw producer string. */
export function producerFamily(producer: string, creator: string): string {
  const s = `${producer} ${creator}`.toLowerCase();
  if (s.trim() === '') return 'unknown';
  if (s.includes('canva')) return 'canva';
  if (s.includes('microsoft') || /\bword\b/.test(s)) return 'word';
  if (s.includes('libreoffice') || s.includes('openoffice')) return 'libreoffice';
  if (s.includes('google') || s.includes('skia')) return 'google_docs';
  if (/pdftex|xetex|luatex|latex|dvips/.test(s)) return 'latex';
  if (s.includes('quartz') || s.includes('macos') || s.includes('mac os')) return 'macos';
  if (s.includes('chrome') || s.includes('chromium')) return 'chrome';
  if (s.includes('wps')) return 'wps';
  if (s.includes('adobe') || s.includes('acrobat') || s.includes('indesign')) return 'adobe';
  if (s.includes('ilovepdf') || s.includes('smallpdf')) return 'online_tool';
  return 'other';
}

function latin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  const raw = latin1(bytes);
  if (/\/Encrypt(?![A-Za-z0-9])/.test(raw)) return { rejected: 'encrypted' };
  const rawJs = /\/(?:JavaScript|JS)(?![A-Za-z0-9])/.test(raw);
  const rawEmbedded = /\/EmbeddedFiles?(?![A-Za-z0-9])/.test(raw);

  let doc;
  try {
    // pdf.js may transfer/detach the buffer; give it a private copy.
    // Held in a variable: isEvalSupported is a real pdf.js option missing from its bundled typings.
    const options = {
      isEvalSupported: false,
      enableXfa: false,
      useSystemFonts: false,
      useWorkerFetch: false,
      disableFontFace: true,
      disableAutoFetch: true,
      disableStream: true,
      cMapUrl: undefined,
      standardFontDataUrl: undefined,
      wasmUrl: undefined,
      iccUrl: undefined,
      maxImageSize: 16_777_216,
      verbosity: 0,
    };
    doc = await getDocumentProxy(bytes.slice(), options);
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    return { rejected: name === 'PasswordException' ? 'encrypted' : 'parse_error' };
  }

  try {
    const pages = doc.numPages;
    if (pages > MAX_PDF_PAGES) return { rejected: 'too_many_pages' };
    if (pages < 1) return { rejected: 'parse_error' };

    const pdfjs = await getResolvedPDFJS();
    const ops = pdfjs.OPS as Record<string, number>;
    const imageOps = new Set<number>(IMAGE_OPS.map((n) => ops[n]).filter((v): v is number => typeof v === 'number'));

    const pageStats: Array<{ chars: number; images: number }> = [];
    const pageTexts: string[] = [];
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) {
          text += item.str;
          if (item.hasEOL) text += '\n';
        }
      }
      text = text.replace(/\u0000/g, '');
      const opList = await page.getOperatorList();
      let images = 0;
      for (const fn of opList.fnArray) if (imageOps.has(fn)) images++;
      pageStats.push({ chars: text.replace(/\s+/g, '').length, images });
      pageTexts.push(text);
      page.cleanup();
    }

    let jsActions = false;
    try {
      jsActions = Boolean(await doc.hasJSActions());
    } catch {
      jsActions = false;
    }

    // Catches attachments hidden in compressed object streams, which the raw-byte scan misses.
    let attachments = false;
    try {
      const att = (await doc.getAttachments()) as Record<string, unknown> | null;
      attachments = att !== null && Object.keys(att).length > 0;
    } catch {
      attachments = false;
    }

    let producer = '';
    let creator = '';
    try {
      const meta = (await doc.getMetadata()) as unknown as { info?: Record<string, unknown> };
      producer = typeof meta.info?.Producer === 'string' ? meta.info.Producer : '';
      creator = typeof meta.info?.Creator === 'string' ? meta.info.Creator : '';
    } catch {
      // metadata is optional
    }

    return {
      kind: 'pdf',
      pages,
      pageStats,
      imageCount: pageStats.reduce((a, s) => a + s.images, 0),
      encrypted: false,
      flags: {
        javascript: rawJs || jsActions,
        embeddedFiles: rawEmbedded || attachments,
        macros: false,
        externalRefs: false,
      },
      producerFamily: producerFamily(producer, creator),
      text: pageTexts.join('\n\n'),
    };
  } catch {
    return { rejected: 'parse_error' };
  } finally {
    await doc.loadingTask.destroy().catch(() => undefined);
  }
}
