/**
 * Hand-maintained allowlist for the two non-ATS source types (CLAUDE.md legal guardrail 5).
 * A host is ingestable only when it has an entry with a dated note. Nothing in the code adds entries.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SOURCE_ALLOWLIST = fileURLToPath(new URL('../source.allowlist.json', import.meta.url));

export interface HostPolicy {
  /** Upper bound on job pages one run may fetch from the host; a larger sitemap fails the board instead of truncating. */
  maxPages?: number;
}
export interface Allowlist {
  jsonld: Record<string, HostPolicy>;
  zoho_rss: Record<string, HostPolicy>;
}

const HOST_RE = /^(?=.{1,100}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
/** Zoho feeds are allowlisted per employer: `<region>-<orgId>`, e.g. `in-60012345678`. */
const ZOHO_RE = /^(com|in|eu|au|jp|ca|sa|cn)-\d{5,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function section(rows: unknown, name: 'jsonld' | 'zoho_rss'): Record<string, HostPolicy> {
  if (!Array.isArray(rows)) throw new Error(`allowlist.${name}: expected an array`);
  const out: Record<string, HostPolicy> = {};
  for (const r of rows as Record<string, unknown>[]) {
    const field = name === 'zoho_rss' ? 'token' : 'host';
    const host = typeof r?.[field] === 'string' ? (r[field] as string).trim().toLowerCase() : '';
    if (!(name === 'zoho_rss' ? ZOHO_RE : HOST_RE).test(host)) throw new Error(`allowlist.${name}: bad ${field} ${JSON.stringify(r?.[field])}`);
    if (typeof r['checked_at'] !== 'string' || !DATE_RE.test(r['checked_at'])) throw new Error(`allowlist.${name}.${host}: checked_at must be YYYY-MM-DD`);
    if (typeof r['note'] !== 'string' || r['note'].trim() === '') throw new Error(`allowlist.${name}.${host}: note must record what was read`);
    const max = r['max_pages'];
    if (max !== undefined && (!Number.isInteger(max) || (max as number) < 1 || (max as number) > 5000)) throw new Error(`allowlist.${name}.${host}: max_pages must be 1..5000`);
    out[host] = max === undefined ? {} : { maxPages: max as number };
  }
  return out;
}

export function parseAllowlist(json: unknown): Allowlist {
  const o = (json ?? {}) as Record<string, unknown>;
  return { jsonld: section(o['jsonld'] ?? [], 'jsonld'), zoho_rss: section(o['zoho_rss'] ?? [], 'zoho_rss') };
}

export function loadAllowlist(path: string = SOURCE_ALLOWLIST): Allowlist {
  return parseAllowlist(JSON.parse(readFileSync(path, 'utf8')));
}
