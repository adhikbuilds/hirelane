/**
 * Company display names and domains. Precedence: boards.json name, then board metadata, then the board token.
 * Metadata is untrusted third-party text: sanitised before it can reach a row.
 */

export type NameSource = 'config' | 'board_metadata' | 'token';
const MAX_NAME = 120;

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .normalize('NFC')
    .replace(/<[^>]*>/g, ' ') // tags first, so entity-encoded markup is not re-created below
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m]!)
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s ? s.slice(0, MAX_NAME) : null;
}

/** Bare, lower-case hostname without www. or trailing dot, or null (URLs, ports, IP literals, single labels all rejected). */
export function canonicalDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const d = raw.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (d.length === 0 || d.length > 253) return null;
  const labels = d.split('.');
  if (labels.length < 2) return null;
  if (!labels.every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1]!)) return null; // IPv4-looking
  return d;
}

export function resolveCompanyName(i: {
  configName: string | null | undefined;
  boardName: string | null | undefined;
  token: string;
}): { name: string; source: NameSource } {
  const c = sanitizeName(i.configName);
  if (c) return { name: c, source: 'config' };
  const b = sanitizeName(i.boardName);
  if (b) return { name: b, source: 'board_metadata' };
  return { name: i.token, source: 'token' };
}

/** Verified path: every job in a recorded Greenhouse `/jobs` response carries `company_name`. */
export function nameFromGreenhouseJobs(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const jobs = (raw as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) return null;
  for (const j of jobs) {
    const n = sanitizeName((j as { company_name?: unknown } | null)?.company_name);
    if (n) return n;
  }
  return null;
}

type NameFetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;

/**
 * [assumption: Greenhouse board-name endpoint] GET https://boards-api.greenhouse.io/v1/boards/{token} returns `{ name, content }`.
 * Observed live on 2026-10-16 (airtable -> "Airtable"); no recording of it exists in fixtures, so callers treat null as normal.
 */
export async function fetchGreenhouseBoardName(token: string, fetchFn: NameFetch, signal?: AbortSignal): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(token)) return null;
  try {
    const res = await fetchFn(`https://boards-api.greenhouse.io/v1/boards/${token}`, { ...(signal ? { signal } : {}), headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: unknown };
    return sanitizeName(body?.name);
  } catch {
    return null;
  }
}
