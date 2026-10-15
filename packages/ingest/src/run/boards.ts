/** Board list from boards.json. Tokens come from this config only, never from users. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Ats } from '../contract';

export interface BoardConfig {
  name: string;
  slug: string;
  domain: string | null;
  ats: Ats;
  token: string;
  hiresInIndia: boolean;
  verifiedAt: Date;
}

export const BOARDS_JSON = fileURLToPath(new URL('../../boards.json', import.meta.url));

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface Entry {
  name: string;
  domain?: string | null;
  ats: Ats;
  token: string;
  hires_in_india?: boolean;
  verified_at?: string | null;
  http_status?: number | null;
}

/** Verified boards only: a `verified_at` stamp and a recorded HTTP 200. */
export function loadBoardConfig(path: string = BOARDS_JSON): BoardConfig[] {
  const entries = JSON.parse(readFileSync(path, 'utf8')) as Entry[];
  return entries
    .filter((e) => e.verified_at && e.http_status === 200)
    .map((e) => ({
      name: e.name,
      slug: slugify(e.name),
      domain: e.domain ?? null,
      ats: e.ats,
      token: e.token,
      hiresInIndia: e.hires_in_india ?? false,
      verifiedAt: new Date(e.verified_at!),
    }));
}
