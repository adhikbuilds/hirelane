/**
 * A small, defensive RFC 5322 / MIME reader for employer mail (no dependency): folded headers, RFC 2047 encoded words,
 * quoted-printable, base64, charsets, multipart/alternative and multipart/mixed (attachments are ignored), HTML-only bodies.
 * It never executes or fetches anything, caps sizes and depth, and never throws on malformed input (it returns what it can).
 */
export interface ParsedMail {
  messageId: string | null;
  fromName: string;
  fromAddress: string;
  to: string[];
  subject: string;
  date: Date | null;
  /** Plain text body (HTML converted), attachments excluded. */
  text: string;
  /** Every Authentication-Results header, topmost (added last by the receiving MTA) first. */
  authResults: string[];
  /** Envelope recipients: Delivered-To / X-Original-To when present, else To. Cc is never used. */
  envelopeTo: string[];
}

const MAX_BYTES = 1_000_000;
const MAX_DEPTH = 5;
const MAX_PARTS = 40;
const MAX_HTML_CHARS = 200_000;

function decodeBytes(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset.trim().replace(/^"|"$/g, '').toLowerCase() || 'utf-8', { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

export function decodeQuotedPrintable(s: string): Buffer {
  const joined = s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i]!;
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
      out.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(...Buffer.from(ch, ch.charCodeAt(0) < 256 ? 'latin1' : 'utf8'));
  }
  return Buffer.from(out);
}

/** RFC 2047 `=?charset?B|Q?text?=` words. Whitespace between two adjacent encoded words is dropped. */
export function decodeEncodedWords(v: string): string {
  const collapsed = v.replace(/(\?=)\s+(=\?)/g, '$1$2');
  return collapsed.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, cs: string, enc: string, text: string) => {
    const bytes = enc.toLowerCase() === 'b' ? Buffer.from(text, 'base64') : decodeQuotedPrintable(text.replace(/_/g, ' '));
    return decodeBytes(bytes, cs.split('*')[0]!);
  });
}

interface Part {
  headers: Map<string, string>;
  /** Every occurrence of each header, in order. */
  multi: Map<string, string[]>;
  body: string;
}

function splitMessage(raw: string): Part {
  const norm = raw.replace(/\r\n/g, '\n');
  const at = norm.search(/\n\n/);
  const head = at === -1 ? norm : norm.slice(0, at);
  const body = at === -1 ? '' : norm.slice(at + 2);
  const headers = new Map<string, string>();
  const multi = new Map<string, string[]>();
  const unfolded = head.replace(/\n[ \t]+/g, ' ');
  for (const line of unfolded.split('\n')) {
    const m = /^([!-9;-~]+):\s*(.*)$/.exec(line);
    if (m) {
      const k = m[1]!.toLowerCase();
      multi.set(k, [...(multi.get(k) ?? []), m[2]!]);
      headers.set(k, headers.has(k) && k !== 'subject' ? `${headers.get(k)}, ${m[2]}` : (headers.get(k) ?? m[2]!));
    }
  }
  return { headers, multi, body };
}

function param(header: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(header);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/**
 * Linear single-pass tag stripper (no backtracking regex). Input is capped, `<script|style|head>` blocks are dropped
 * up to their closing tag (or to the end when unclosed), block-level closers become newlines, every other tag a space.
 */
function stripTags(html: string): string {
  const src = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
  const lower = src.toLowerCase();
  const out: string[] = [];
  const n = src.length;
  let i = 0;
  let lt = src.indexOf('<');
  while (lt !== -1) {
    if (lt > i) out.push(src.slice(i, lt));
    const m = /^<(\/?)([a-z][a-z0-9]*)/.exec(src.slice(lt, lt + 24).toLowerCase());
    if (!m) {
      // A lone "<" that does not start a tag is plain text.
      out.push('<');
      i = lt + 1;
      lt = src.indexOf('<', i);
      continue;
    }
    const close = src.indexOf('>', lt + 1);
    const name = m[2]!;
    if (m[1] === '' && (name === 'script' || name === 'style' || name === 'head')) {
      const end = lower.indexOf(`</${name}`, lt + 1);
      if (end === -1) {
        i = n;
        break;
      }
      const endClose = src.indexOf('>', end);
      out.push(' ');
      i = endClose === -1 ? n : endClose + 1;
    } else {
      if (close === -1) {
        i = n;
        break;
      }
      const blockEnd = m[1] === '/' && /^(p|div|li|tr|h[1-6])$/.test(name);
      out.push(blockEnd || (m[1] === '' && name === 'br') ? '\n' : ' ');
      i = close + 1;
    }
    lt = src.indexOf('<', i);
  }
  if (i < n) out.push(src.slice(i));
  return out.join('');
}

export function htmlToText(html: string): string {
  const stripped = stripTags(html);
  return stripped
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const cp = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
      }
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function bodyText(part: Part, depth: { n: number }): { plain: string[]; html: string[] } {
  const out = { plain: [] as string[], html: [] as string[] };
  if (++depth.n > MAX_PARTS) return out;
  const ct = part.headers.get('content-type') ?? 'text/plain';
  const type = ct.split(';')[0]!.trim().toLowerCase();
  const disp = (part.headers.get('content-disposition') ?? '').toLowerCase();
  if (disp.startsWith('attachment')) return out;
  if (type.startsWith('multipart/')) {
    const boundary = param(ct, 'boundary');
    if (!boundary || depth.n > MAX_DEPTH * 8) return out;
    const marker = `--${boundary}`;
    const chunks = part.body.split(new RegExp(`^${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*$`, 'm'));
    for (const chunk of chunks.slice(1)) {
      const sub = splitMessage(chunk.replace(/^\n/, ''));
      const r = bodyText(sub, depth);
      out.plain.push(...r.plain);
      out.html.push(...r.html);
    }
    return out;
  }
  if (type !== 'text/plain' && type !== 'text/html') return out;
  const cte = (part.headers.get('content-transfer-encoding') ?? '7bit').trim().toLowerCase();
  const charset = param(ct, 'charset') ?? 'utf-8';
  let bytes: Buffer;
  if (cte === 'base64') bytes = Buffer.from(part.body.replace(/\s+/g, ''), 'base64');
  else if (cte === 'quoted-printable') bytes = decodeQuotedPrintable(part.body);
  else bytes = Buffer.from(part.body, 'utf8');
  const text = cte === 'base64' || cte === 'quoted-printable' ? decodeBytes(bytes, charset) : part.body;
  (type === 'text/html' ? out.html : out.plain).push(text);
  return out;
}

/** `"Name" <a@b.test>` or `a@b.test` to its parts. */
export function parseAddress(v: string): { name: string; address: string } {
  const decoded = decodeEncodedWords(v);
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>\s]+)>/.exec(decoded);
  if (m) return { name: (m[1] ?? '').trim(), address: m[2]!.trim().toLowerCase() };
  const bare = /([^\s<>,;"]+@[^\s<>,;"]+)/.exec(decoded);
  return { name: '', address: bare ? bare[1]!.toLowerCase() : '' };
}

export function allAddresses(v: string): string[] {
  const out: string[] = [];
  for (const m of decodeEncodedWords(v).matchAll(/[^\s<>,;"()]+@[^\s<>,;"()]+/g)) out.push(m[0]!.toLowerCase().replace(/[.,]+$/, ''));
  return out;
}

export function parseEml(source: string | Buffer): ParsedMail {
  const raw = (typeof source === 'string' ? source : source.subarray(0, MAX_BYTES).toString('utf8')).slice(0, MAX_BYTES);
  const msg = splitMessage(raw);
  const h = (k: string) => msg.headers.get(k) ?? '';
  const from = parseAddress(h('from'));
  const parts = bodyText(msg, { n: 0 });
  const text = parts.plain.join('\n').trim() || htmlToText(parts.html.join('\n'));
  const date = h('date') ? new Date(h('date')) : null;
  const envelope = [...new Set([...allAddresses(h('delivered-to')), ...allAddresses(h('x-original-to'))])];
  if (envelope.length === 0) envelope.push(...new Set(allAddresses(h('to'))));
  const mid = /<([^>\s]+)>/.exec(h('message-id'));
  return {
    messageId: mid ? mid[1]! : null,
    fromName: from.name,
    fromAddress: from.address,
    to: [...new Set([...allAddresses(h('delivered-to')), ...allAddresses(h('x-original-to')), ...allAddresses(h('to')), ...allAddresses(h('cc'))])],
    envelopeTo: envelope,
    authResults: msg.multi.get('authentication-results') ?? [],
    subject: decodeEncodedWords(h('subject')).replace(/\s+/g, ' ').trim(),
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    text,
  };
}
