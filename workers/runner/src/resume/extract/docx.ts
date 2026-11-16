/**
 * DOCX extraction: zip guard, then a hand-written w:t / w:p walk. There is no XML parser.
 * Only the five predefined XML entities and numeric character references are decoded.
 */
import { guardAndInflate } from './zip-guard';
import type { ExtractResult } from './types';

const dec = new TextDecoder('utf-8');

/** Decode one inflated XML part, or null when its encoding could hide markup from the scans. */
function decodePart(bytes: Uint8Array): string | null {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return null; // UTF-16
  }
  if (bytes.indexOf(0) !== -1) return null; // NUL bytes: UTF-16/32 without BOM
  return dec.decode(bytes);
}

function hasDoctype(s: string): boolean {
  const l = s.toLowerCase();
  return l.includes('<!doctype') || l.includes('<!entity');
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  let out = '';
  let i = 0;
  for (;;) {
    const amp = s.indexOf('&', i);
    if (amp === -1) return out + s.slice(i);
    out += s.slice(i, amp);
    const semi = s.indexOf(';', amp + 1);
    if (semi === -1 || semi - amp > 10) {
      out += '&';
      i = amp + 1;
      continue;
    }
    const body = s.slice(amp + 1, semi);
    let rep: string | null = null;
    if (body in NAMED) rep = NAMED[body]!;
    else if (body[0] === '#') {
      const hex = body[1] === 'x';
      const digits = hex ? body.slice(2) : body.slice(1);
      if (digits.length > 0 && (hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits)) {
        const cp = parseInt(digits, hex ? 16 : 10);
        const ok =
          cp <= 0x10ffff &&
          !(cp >= 0xd800 && cp <= 0xdfff) &&
          (cp >= 0x20 || cp === 0x9 || cp === 0xa || cp === 0xd);
        rep = ok ? String.fromCodePoint(cp) : '';
      }
    }
    if (rep === null) {
      out += '&'; // unknown entity: keep literally
      i = amp + 1;
    } else {
      out += rep;
      i = semi + 1;
    }
  }
}

/** Linear scanner over the tags that carry text. Uses indexOf only, so no regex backtracking. */
export function walkWordXml(xml: string): string {
  let out = '';
  let inT = false;
  let inRun = false;
  let vanish = false;
  let fallback = 0;
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      if (inT && !vanish && fallback === 0) out += decodeEntities(xml.slice(i));
      break;
    }
    if (inT && !vanish && fallback === 0 && lt > i) out += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      if (e === -1) break;
      i = e + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      if (e === -1) break;
      if (inT && !vanish && fallback === 0) out += xml.slice(lt + 9, e);
      i = e + 3;
      continue;
    }
    const gt = xml.indexOf('>', lt + 1);
    if (gt === -1) break;
    const raw = xml.slice(lt + 1, gt);
    const selfClose = raw.endsWith('/');
    const closing = raw.startsWith('/');
    let k = closing ? 1 : 0;
    let nameEnd = k;
    while (nameEnd < raw.length) {
      const c = raw.charCodeAt(nameEnd);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 47) break;
      nameEnd++;
    }
    const name = raw.slice(k, nameEnd);
    if (name === 'mc:Fallback') {
      if (closing) fallback = Math.max(0, fallback - 1);
      else if (!selfClose) fallback++;
    } else if (fallback === 0) {
      if (name === 'w:r') {
        inRun = !closing && !selfClose;
        vanish = false; // hidden-text state never leaks into the next run
      } else if (name === 'w:vanish' && !closing && inRun) {
        vanish = !/w:val\s*=\s*["'](?:0|false|off)["']/i.test(raw);
      } else if (name === 'w:t') inT = !closing && !selfClose;
      else if (name === 'w:p') {
        if (closing) out += '\n';
      } else if (!closing) {
        if (name === 'w:tab') out += '\t';
        else if (name === 'w:br' || name === 'w:cr') out += '\n';
        else if (name === 'w:noBreakHyphen') out += '-';
      }
    }
    i = gt + 1;
  }
  return out;
}

const countNonSpace = (s: string) => s.replace(/\s+/g, '').length;

export function extractDocx(bytes: Uint8Array): ExtractResult {
  const g = guardAndInflate(bytes);
  if (!g.ok) return { rejected: g.code };

  const texts = new Map<string, string>();
  for (const [name, data] of g.parts) {
    const s = decodePart(data);
    if (s === null) return { rejected: 'parse_error' };
    texts.set(name, s);
  }
  for (const s of texts.values()) if (hasDoctype(s)) return { rejected: 'doctype' };

  const ct = texts.get('[Content_Types].xml') ?? '';
  if (ct.includes('macroEnabled')) return { rejected: 'macro' };
  const doc = texts.get('word/document.xml');
  if (doc === undefined) return { rejected: 'parse_error' };
  const rels = texts.get('word/_rels/document.xml.rels') ?? '';
  if (doc.includes('altChunk') || rels.includes('aFChunk') || rels.includes('altChunk')) {
    return { rejected: 'zip_guard' };
  }

  const names = [...texts.keys()].sort();
  const headers = names.filter((x) => /^word\/header\d*\.xml$/.test(x));
  const footers = names.filter((x) => /^word\/footer\d*\.xml$/.test(x));
  const pieces = [...headers, 'word/document.xml', ...footers].map((nm) => walkWordXml(texts.get(nm)!));
  const text = pieces.join('\n');

  return {
    kind: 'docx',
    pages: null,
    pageStats: [{ chars: countNonSpace(text), images: g.mediaCount }],
    imageCount: g.mediaCount,
    encrypted: false,
    flags: {
      javascript: false,
      embeddedFiles: g.embeddedCount > 0,
      macros: false,
      externalRefs: rels.includes('TargetMode="External"') || rels.includes("TargetMode='External'"),
    },
    producerFamily: 'unknown',
    text,
  };
}
