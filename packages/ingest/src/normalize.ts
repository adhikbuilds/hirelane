import { createHash } from 'node:crypto';
import type { BoardRef, NormalizeResult, RawPosting } from './contract';

/** Bump to "v2:" only on a deliberate definition change: it re-enriches every posting (see docs/ingest.md). */
export const CONTENT_HASH_VERSION = 'v1';
const MAX_KEY = 255;

const isHttps = (u: string): boolean => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

const str = (s: string | null | undefined): string | null => (s == null ? null : s.normalize('NFC').trim());

/** Keys sorted recursively, undefined becomes null, no insignificant whitespace. */
export function canonicalJson(v: unknown): string {
  if (v === undefined || v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function contentHash(p: RawPosting): string {
  const c = p.compensation;
  const H = {
    title: str(p.title),
    locations: p.locationsRaw.map((l) => str(l)).sort(),
    description: p.descriptionHtml == null ? null : str(p.descriptionHtml.normalize('NFC').replace(/\s+/g, ' ')),
    applyUrl: str(p.applyUrl),
    department: str(p.department),
    team: str(p.team),
    employmentRaw: str(p.employmentRaw),
    workplaceRaw: str(p.workplaceRaw),
    isRemoteHint: p.isRemoteHint ?? null,
    compensation: c
      ? { min: c.min, max: c.max, currency: str(c.currency), interval: c.interval, kind: c.kind, summaryText: str(c.summaryText) }
      : null,
  };
  return `${CONTENT_HASH_VERSION}:${createHash('sha256').update(canonicalJson(H), 'utf8').digest('hex')}`;
}

/** Pure mapping of a RawPosting to the postings columns. No clock, no I/O. */
export function normalize(board: BoardRef, p: RawPosting, ctx: { source: 'live' | 'fixture' }): NormalizeResult {
  const fail = (reason: 'missing_title' | 'bad_url' | 'key_too_long'): NormalizeResult => ({ ok: false, externalId: p.externalId, reason });
  const title = p.title.trim();
  if (!title) return fail('missing_title');
  if (!isHttps(p.url)) return fail('bad_url');
  const key = `${board.ats}:${board.token}:${p.externalId}`;
  if (key.length > MAX_KEY) return fail('key_too_long');
  const posted = p.postedAt ? new Date(p.postedAt) : null;
  return {
    ok: true,
    posting: {
      boardId: board.id,
      externalId: p.externalId,
      key,
      url: p.url,
      applyUrl: p.applyUrl && isHttps(p.applyUrl) ? p.applyUrl : null,
      title,
      locationRaw: p.locationsRaw.length ? p.locationsRaw.join(' · ') : null,
      raw: p.raw,
      contentHash: contentHash(p),
      postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
      source: ctx.source,
    },
  };
}
