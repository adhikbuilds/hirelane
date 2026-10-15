import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { Ats, BoardFetch, FetchBoardOptions, IngestMode } from '../src/contract';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** Byte-exact recorded body of one board. */
export function fixtureText(root: 'mini' | 'full', ats: Ats, token: string): string {
  return gunzipSync(readFileSync(`${FIXTURES}${root}/${ats}/${token}.json.gz`)).toString('utf8');
}

export function fixtureJson<T = any>(root: 'mini' | 'full', ats: Ats, token: string): T {
  return JSON.parse(fixtureText(root, ats, token)) as T;
}

export interface Call {
  url: string;
  init: { signal: AbortSignal; headers: Record<string, string> };
}

/** A fetch that serves `body` once with the given status and records every call. */
export function stubFetch(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): { fetch: BoardFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: BoardFetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status, headers });
  };
  return { fetch, calls };
}

export function throwingFetch(err: unknown): BoardFetch {
  return async () => {
    throw err;
  };
}

export function opts(fetch: BoardFetch, mode: IngestMode = 'fixture', signal?: AbortSignal): FetchBoardOptions {
  return { mode, fetch, signal: signal ?? new AbortController().signal };
}
