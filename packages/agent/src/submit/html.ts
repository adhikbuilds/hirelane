/** A tiny, forgiving HTML tokenizer: enough to read an application form. No dependency, no DOM, scripts and styles dropped. */
export interface Tok {
  type: 'open' | 'close' | 'text';
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...' };
export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
function attrsOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR)) out[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

export function tokenize(html: string): Tok[] {
  const toks: Tok[] = [];
  const re = /<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|</g;
  for (const m of html.matchAll(re)) {
    if (m[5] !== undefined) {
      const text = decode(m[5]).replace(/\s+/g, ' ').trim();
      if (text) toks.push({ type: 'text', tag: '', attrs: {}, text });
    } else if (m[3] !== undefined) {
      toks.push({ type: m[2] ? 'close' : 'open', tag: m[3].toLowerCase(), attrs: m[2] ? {} : attrsOf(m[4] ?? ''), text: '' });
    }
  }
  return toks;
}

/** A label as a person reads it: no required markers, no trailing colon. */
export function cleanLabel(s: string): string {
  return s.replace(/[✱*]/g, ' ').replace(/\(\s*(?:required|optional)\s*\)/gi, ' ').replace(/\s+/g, ' ').replace(/[:\s]+$/g, '').trim();
}
export const looksRequired = (s: string): boolean => /[✱*]/.test(s) || /\(\s*required\s*\)/i.test(s);
