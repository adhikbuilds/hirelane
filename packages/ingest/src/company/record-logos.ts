/**
 * One-off recorder for fixtures/logos: fetches each mini board's logo through the same guarded pipeline the
 * worker uses, writes `{slug}.png` and a manifest with source + date. Boards with no usable own-domain icon
 * are listed as monograms (no file). Run: pnpm --filter @hirelane/ingest exec vite-node src/company/record-logos.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadBoardConfig } from '../run/boards';
import { fetchCompanyLogo } from './logo';
import { createGuardedFetch, systemLookup } from './transport';

const MINI_SLUGS = ['airtable', 'benchling', 'cred', 'openai', 'temporal'];
const OUT = fileURLToPath(new URL('../../fixtures/logos/', import.meta.url));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const boards = loadBoardConfig().filter((b) => MINI_SLUGS.includes(b.slug));
  const manifest: Record<string, unknown> = {};
  const deps = { fetch: createGuardedFetch(), lookup: systemLookup };
  for (const b of boards) {
    const r = await fetchCompanyLogo(b.domain, deps);
    const recordedAt = new Date().toISOString();
    if (r.ok) {
      writeFileSync(`${OUT}${b.slug}.png`, r.png);
      manifest[b.slug] = { source: 'fetched', domain: b.domain, url: r.sourceUrl, recordedAt };
    } else {
      manifest[b.slug] = { source: 'monogram', domain: b.domain, reason: r.reason, attempts: r.attempts, recordedAt };
    }
    console.log(b.slug, r.ok ? `ok ${r.sourceUrl}` : JSON.stringify(r.attempts));
  }
  writeFileSync(`${OUT}manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
}

void main();
