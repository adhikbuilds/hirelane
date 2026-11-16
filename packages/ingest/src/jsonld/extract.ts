/**
 * Pulls schema.org JobPosting objects out of `<script type="application/ld+json">` blocks.
 * Only the parsed JSON-LD objects leave this function: page HTML is never returned or stored (CLAUDE.md rule 2).
 */

export const MAX_BLOCKS = 20;
export const MAX_BLOCK_BYTES = 500_000;

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const LD_TYPE_RE = /\btype\s*=\s*(?:"application\/ld\+json[^"]*"|'application\/ld\+json[^']*'|application\/ld\+json)/i;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function hasJobType(t: unknown): boolean {
  const norm = (s: unknown) => typeof s === 'string' && /(^|[/#])JobPosting$/.test(s.trim());
  return Array.isArray(t) ? t.some(norm) : norm(t);
}

function walk(node: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 5) return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out, depth + 1);
    return;
  }
  if (!isObj(node)) return;
  if (hasJobType(node['@type'])) out.push(node);
  if (node['@graph'] !== undefined) walk(node['@graph'], out, depth + 1);
}

export function extractJobPostings(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let blocks = 0;
  SCRIPT_RE.lastIndex = 0;
  for (let m = SCRIPT_RE.exec(html); m; m = SCRIPT_RE.exec(html)) {
    if (!LD_TYPE_RE.test(m[1]!)) continue;
    if (++blocks > MAX_BLOCKS) break;
    const body = m[2]!;
    if (body.length > MAX_BLOCK_BYTES) continue;
    const json = body.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
    try {
      walk(JSON.parse(json), out);
    } catch {
      /* malformed block: skip it */
    }
  }
  return out;
}
