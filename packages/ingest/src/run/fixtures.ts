/**
 * Fixture mode transport: serves recorded bodies through the same connectors as live mode.
 * Only URLs of configured boards are served, so there is no free-form file access.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { connectors } from '../connectors';
import type { Ats, BoardFetch } from '../contract';

export const DEFAULT_FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/full/', import.meta.url));

export type InjectMap = Record<string, number>;

/** `["ashby:openai=500"]` -> `{ "ashby:openai": 500 }`. */
export function parseInject(specs: string[]): InjectMap {
  const out: InjectMap = {};
  for (const s of specs) {
    const m = /^(greenhouse|lever|ashby):([A-Za-z0-9._-]+)=(\d{3})$/.exec(s);
    const status = m ? Number(m[3]) : NaN;
    if (!m || status < 100 || status > 599) throw new Error(`bad --inject-status "${s}", expected ats:token=STATUS`);
    out[`${m[1]}:${m[2]}`] = status;
  }
  return out;
}

export interface FixtureFetchOptions {
  dir?: string;
  boards: { ats: Ats; token: string }[];
  inject?: InjectMap;
}

export function createFixtureFetch(opts: FixtureFetchOptions): BoardFetch {
  const dir = opts.dir ?? DEFAULT_FIXTURES_DIR;
  const inject = opts.inject ?? {};
  const byUrl = new Map(opts.boards.map((b) => [connectors[b.ats].boardUrl(b.token), b]));

  return async (url) => {
    const board = byUrl.get(url);
    if (!board) throw new Error(`unknown fixture url: ${url}`);
    const key = `${board.ats}:${board.token}`;
    const forced = inject[key];
    if (forced !== undefined) return new Response(`injected ${forced}`, { status: forced });
    try {
      const text = gunzipSync(readFileSync(join(dir, board.ats, `${board.token}.json.gz`))).toString('utf8');
      return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Response('fixture missing', { status: 404 });
      throw e;
    }
  };
}
