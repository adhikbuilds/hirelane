import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateTokens } from './candidates';
import { probeAll, type Candidate, type Hit, type ProbeOptions, type ProbeResult } from './probe';

const pkg = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
export const SEED_JSON = pkg('data/discovery-candidates.json');
export const KNOWN_BOARD_FILES = [pkg('boards.json'), pkg('boards.candidates.json')];
export const CACHE_DIR = fileURLToPath(new URL('../../../../.cache/discovery', import.meta.url));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Names and tokens already in boards.json / boards.candidates.json; discovery skips them. */
export function loadKnown(files: string[] = KNOWN_BOARD_FILES): { names: Set<string>; tokens: Set<string> } {
  const names = new Set<string>();
  const tokens = new Set<string>();
  for (const f of files) {
    let rows: unknown;
    try {
      rows = JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const r of rows as Array<{ name?: unknown; token?: unknown }>) {
      if (typeof r?.name === 'string') names.add(norm(r.name));
      if (typeof r?.token === 'string') tokens.add(r.token.toLowerCase());
    }
  }
  return { names, tokens };
}

export function loadSeedNames(path: string = SEED_JSON): string[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) throw new Error(`${path}: expected an array of strings`);
  return raw as string[];
}

/** Expands names to (name, token) pairs, dropping already-ingested companies and duplicate tokens. */
export function buildCandidates(names: string[], known: { names: Set<string>; tokens: Set<string> }): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (known.names.has(norm(name))) continue;
    for (const token of candidateTokens(name)) {
      if (known.tokens.has(token) || seen.has(token)) continue;
      seen.add(token);
      out.push({ name, token });
    }
  }
  return out;
}

export function dateStamp(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function writeHits(hits: Hit[], dir: string = CACHE_DIR, date: string = dateStamp()): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${date}.jsonl`);
  writeFileSync(file, hits.map((h) => JSON.stringify(h)).join('\n') + (hits.length ? '\n' : ''));
  return file;
}

export async function runDiscovery(opts: {
  names: string[];
  known: { names: Set<string>; tokens: Set<string> };
  probe: ProbeOptions;
  outDir?: string;
  date?: string;
}): Promise<{ result: ProbeResult; file: string; candidates: Candidate[] }> {
  const candidates = buildCandidates(opts.names, opts.known);
  const result = await probeAll(candidates, opts.probe);
  const file = writeHits(result.hits, opts.outDir, opts.date);
  return { result, file, candidates };
}
