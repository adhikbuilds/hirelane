/** `pnpm ingest:record`: live recorder. Manual only, never run in CI. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordBoards, type Candidate } from './record';

if (process.env.CI) {
  console.error('ingest:record is live and must never run in CI.');
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const candidates = JSON.parse(readFileSync(join(root, 'boards.candidates.json'), 'utf8')) as Candidate[];
console.log(`recording ${candidates.length} candidates (1 req/s per host)...`);

const r = await recordBoards({
  candidates,
  fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
  outDir: root,
});

const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
console.log(`verified boards: ${r.boards.length} / ${candidates.length}`);
console.log(`total postings:  ${r.totalPostings}`);
console.log(`fixture size:    ${mb(r.totalGzBytes)} MB gzipped (budget 25 MB)`);
console.log(`mini:            ${r.mini.join(', ')}`);
if (r.trimmed.length) console.log(`trimmed:         ${r.trimmed.map((t) => `${t.ats}:${t.token}`).join(', ')}`);
const reasons = new Map<string, number>();
for (const d of r.dropped) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
console.log(`dropped:         ${r.dropped.length} (${[...reasons].map(([k, v]) => `${k}=${v}`).join(', ')})`);
