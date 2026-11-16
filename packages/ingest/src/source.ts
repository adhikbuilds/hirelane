/**
 * Where a job came from (migration 0018: jobs.source_kind / source_label / source_url). Pure.
 * The SQL trigger in 0018 derives the same values for ingested postings; this module is the TypeScript twin used by
 * tests, the coverage report and the user-shared / campus paths. user_shared stores ONLY the pasted URL and a platform
 * label: the page behind it is never fetched or scraped.
 */
import type { Ats } from './contract';

export const SOURCE_KINDS = ['greenhouse', 'lever', 'ashby', 'jsonld', 'zoho_rss', 'campus_drive', 'user_shared'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface SourceFields {
  sourceKind: SourceKind;
  sourceLabel: string;
  sourceUrl: string;
}

const ATS_NAME: Record<'greenhouse' | 'lever' | 'ashby', string> = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby' };

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return u;
  }
};

export function sourceForPosting(p: { ats: Ats; boardToken: string; companyName: string; url: string }): SourceFields {
  switch (p.ats) {
    case 'greenhouse':
    case 'lever':
    case 'ashby':
      return { sourceKind: p.ats, sourceLabel: `${ATS_NAME[p.ats]} · ${p.companyName}`, sourceUrl: p.url };
    case 'jsonld':
      return { sourceKind: 'jsonld', sourceLabel: p.boardToken, sourceUrl: p.url };
    case 'zoho_rss':
      return { sourceKind: 'zoho_rss', sourceLabel: hostOf(p.url), sourceUrl: p.url };
  }
}

export const SHARE_PLATFORMS = ['reddit', 'whatsapp', 'linkedin', 'telegram', 'other'] as const;
export type SharePlatform = (typeof SHARE_PLATFORMS)[number];

const PLATFORM_LABEL: Record<SharePlatform, string> = {
  reddit: 'Shared from Reddit', whatsapp: 'Shared from WhatsApp', linkedin: 'Shared from LinkedIn', telegram: 'Shared from Telegram', other: 'Shared link',
};

const MAX_URL = 2000;
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|\d{1,3}(\.\d{1,3}){3}|\[.*\])$/i;

export type SharedResult = { ok: true; fields: SourceFields } | { ok: false; reason: 'bad_platform' | 'bad_url' };

/** Validates a pasted link. Pure string work: there is deliberately no fetch in this module. */
export function userSharedSource(rawUrl: string, platform: SharePlatform): SharedResult {
  if (!(SHARE_PLATFORMS as readonly string[]).includes(platform)) return { ok: false, reason: 'bad_platform' };
  const s = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!s || s.length > MAX_URL) return { ok: false, reason: 'bad_url' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: 'bad_url' };
  }
  if (u.protocol !== 'https:' || u.username || u.password || PRIVATE_HOST.test(u.hostname) || !u.hostname.includes('.')) return { ok: false, reason: 'bad_url' };
  u.hash = '';
  return { ok: true, fields: { sourceKind: 'user_shared', sourceLabel: PLATFORM_LABEL[platform], sourceUrl: u.toString() } };
}

export function campusDriveSource(college: string, driveUrl: string): SourceFields {
  return { sourceKind: 'campus_drive', sourceLabel: `Campus drive · ${college.trim()}`, sourceUrl: driveUrl };
}
