/**
 * Canonical text (`Doc`): the frame for all evidence offsets. Pure and deterministic.
 * Offsets are UTF-16 code units, half-open [start, end), into Doc.text.
 */
import { DOC_FORMAT_VERSION } from './version';

export type BlockKind = 'heading' | 'bullet' | 'paragraph';

export interface Block {
  kind: BlockKind;
  /** Offsets into Doc.text, block text only (no separator). */
  start: number;
  end: number;
  /** heading: 1..6 (bold-only line = 4, "Label:" line = 5); bullet: nesting depth 1..; paragraph: 0. */
  level: number;
  /** e.g. 'text.heading.h3', 'text.heading.bold_line', 'text.heading.colon_line', 'text.bullet', 'text.paragraph'. */
  ruleId: string;
}

export interface Doc {
  format: typeof DOC_FORMAT_VERSION;
  /** NFC, entities decoded, tags stripped, intra-block whitespace collapsed. */
  text: string;
  /** Document order; blocks never overlap. */
  blocks: Block[];
  /** fnv1a64(text), 16 lowercase hex. */
  hash: string;
}

/** FNV-1a 64 over the UTF-8 encoding of `s`, as 16 lowercase hex digits. */
export function fnv1a64(s: string): string {
  const MASK = 0xffffffffffffffffn;
  const PRIME = 0x100000001b3n;
  let h = 0xcbf29ce484222325n;
  const eat = (byte: number): void => {
    h ^= BigInt(byte);
    h = (h * PRIME) & MASK;
  };
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) eat(cp);
    else if (cp < 0x800) {
      eat(0xc0 | (cp >> 6));
      eat(0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      eat(0xe0 | (cp >> 12));
      eat(0x80 | ((cp >> 6) & 0x3f));
      eat(0x80 | (cp & 0x3f));
    } else {
      eat(0xf0 | (cp >> 18));
      eat(0x80 | ((cp >> 12) & 0x3f));
      eat(0x80 | ((cp >> 6) & 0x3f));
      eat(0x80 | (cp & 0x3f));
    }
  }
  return h.toString(16).padStart(16, '0');
}

const NAMED: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', cent: '¢',
  deg: '°', times: '×', laquo: '«', raquo: '»', sect: '§', para: '¶', plusmn: '±', frac12: '½', rarr: '→', larr: '←',
};

/** One decode pass (no double decoding). Unknown or malformed entities are left as written. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,9}));/g, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name !== undefined) return NAMED[name] ?? whole;
    const cp = dec !== undefined ? Number(dec) : parseInt(hex!, 16);
    if (!Number.isFinite(cp) || cp < 1 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return whole;
    return String.fromCodePoint(cp);
  });
}

const collapse = (s: string): string => s.replace(/[\s ]+/g, ' ').trim().normalize('NFC');

class DocBuilder {
  text = '';
  blocks: Block[] = [];

  add(kind: BlockKind, level: number, ruleId: string, blockText: string): void {
    if (blockText === '') return;
    if (this.blocks.length > 0) this.text += kind === 'heading' ? '\n\n' : '\n';
    const start = this.text.length;
    this.text += blockText;
    this.blocks.push({ kind, start, end: this.text.length, level, ruleId });
  }

  finish(): Doc {
    return { format: DOC_FORMAT_VERSION, text: this.text, blocks: this.blocks, hash: fnv1a64(this.text) };
  }
}

const BLOCK_TAGS = new Set(['p', 'div', 'li', 'ul', 'ol', 'br', 'tr', 'table', 'section', 'article', 'blockquote', 'pre', 'hr', 'dl', 'dt', 'dd', 'header', 'footer', 'main', 'aside', 'figure', 'td', 'th', 'thead', 'tbody']);
const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

/** `html` is RawPosting.descriptionHtml, which Greenhouse has already decoded once in the connector. */
export function toDoc(html: string | null): Doc {
  const b = new DocBuilder();
  if (html === null || html.trim() === '') return b.finish();

  let buf = '';
  let boldDepth = 0;
  let sawBold = false;
  let sawPlain = false;
  let heading = 0;
  const lists: string[] = [];
  const liDepths: number[] = [];

  const flush = (): void => {
    const t = collapse(buf);
    const bold = sawBold && !sawPlain;
    buf = '';
    sawBold = false;
    sawPlain = false;
    if (t === '') return;
    if (liDepths.length > 0) b.add('bullet', liDepths[liDepths.length - 1]!, 'text.bullet', t);
    else if (heading > 0) b.add('heading', heading, `text.heading.h${heading}`, t);
    else if (bold) b.add('heading', 4, 'text.heading.bold_line', t);
    else if (t.length <= 60 && t.endsWith(':')) b.add('heading', 5, 'text.heading.colon_line', t);
    else b.add('paragraph', 0, 'text.paragraph', t);
  };

  const addText = (raw: string): void => {
    if (raw === '') return;
    const t = decodeEntities(raw);
    buf += t;
    if (/\S/.test(t.replace(/ /g, ' '))) {
      if (boldDepth > 0) sawBold = true;
      else sawPlain = true;
    }
  };

  let last = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    addText(html.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[0].startsWith('<!--')) continue;
    const closing = m[1] === '/';
    const name = m[2]!.toLowerCase();
    if (!closing && (name === 'script' || name === 'style')) {
      const close = html.toLowerCase().indexOf(`</${name}`, last);
      if (close === -1) {
        last = html.length;
        break;
      }
      const end = html.indexOf('>', close);
      last = end === -1 ? html.length : end + 1;
      TAG_RE.lastIndex = last;
      continue;
    }
    if (name === 'strong' || name === 'b') {
      boldDepth = Math.max(0, boldDepth + (closing ? -1 : 1));
      continue;
    }
    const hm = /^h([1-6])$/.exec(name);
    if (hm) {
      flush();
      heading = closing ? 0 : Number(hm[1]);
      continue;
    }
    if (!BLOCK_TAGS.has(name)) continue;
    flush();
    if (name === 'ul' || name === 'ol') {
      if (closing) lists.pop();
      else lists.push(name);
    } else if (name === 'li') {
      if (closing) liDepths.pop();
      else liDepths.push(Math.max(1, lists.length));
    }
  }
  addText(html.slice(last));
  flush();
  return b.finish();
}

/** Plain-text input (titles, test corpora). Each non-empty line becomes one paragraph block. */
export function docFromText(text: string): Doc {
  const b = new DocBuilder();
  for (const line of text.split(/\r\n|\r|\n/)) b.add('paragraph', 0, 'text.paragraph', collapse(line));
  return b.finish();
}
