import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * withAdmin runs as the owner role. Under "ENABLE without FORCE" RLS the owner reads across users,
 * so user-facing code must use withUser. This guard keeps withAdmin to the places that need it.
 */
export const ALLOWLIST: { pattern: string; why: string }[] = [
  // Decided 2026-10-28 (design doc 1, withadmin-allowlist)
  { pattern: 'apps/web/app/api/public/**', why: 'public read API' },
  { pattern: 'apps/web/app/jobs/**', why: 'public board' },
  { pattern: 'apps/web/app/api/webhooks/**', why: 'verify, persist, enqueue' },
  { pattern: 'apps/web/lib/auth/**', why: 'session and OTP lookups before a user context exists' },
  { pattern: 'apps/web/app/ops/**', why: 'operator pages' },
  { pattern: 'workers/**', why: 'job runner' },
  { pattern: 'packages/ingest/**', why: 'ingestion' },
  // Existing legitimate callers found on 2026-10-28 (all read public job data or the waitlist)
  { pattern: 'packages/db/**', why: 'defines withAdmin; migrate, seed, reset, verify scripts' },
  { pattern: 'apps/web/app/lists/**', why: 'public curated lists (added)' },
  { pattern: 'apps/web/components/**', why: 'public landing and job-page data (added)' },
  { pattern: 'apps/web/lib/queries/**', why: 'public job and company queries (added)' },
  { pattern: 'apps/web/lib/ingest-data.ts', why: 'public status page data (added)' },
  { pattern: 'apps/web/lib/job-data.ts', why: 'public job page data (added)' },
  { pattern: 'apps/web/lib/job-markdown-data.ts', why: 'public job markdown (added)' },
  { pattern: 'apps/web/lib/sitemap-http.ts', why: 'sitemaps (added)' },
  { pattern: 'apps/web/lib/waitlist.ts', why: 'pre-account waitlist (added)' },
  // Tests set up fixtures as the owner.
  { pattern: '**/test/**', why: 'tests' },
  { pattern: '**/tests/**', why: 'tests' },
  { pattern: '**/*.test.ts', why: 'tests' },
  { pattern: '**/*.test.tsx', why: 'tests' },
  { pattern: 'e2e/**', why: 'e2e fixtures' },
  { pattern: 'apps/web/e2e-support/**', why: 'e2e fixtures' },
];

function toRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; ) {
    if (glob.startsWith('**/', i)) (out += '(?:.*/)?'), (i += 3);
    else if (glob.startsWith('**', i)) (out += '.*'), (i += 2);
    else if (glob[i] === '*') (out += '[^/]*'), i++;
    else (out += glob[i]!.replace(/[.+^${}()|[\]\\?]/g, '\\$&')), i++;
  }
  return new RegExp(`^${out}$`);
}
const COMPILED = ALLOWLIST.map((a) => toRegExp(a.pattern));

export function isAllowedPath(rel: string): boolean {
  const p = rel.split(sep).join('/');
  return COMPILED.some((re) => re.test(p));
}

/** 1-based line numbers that mention the identifier. */
export function scanContent(text: string): number[] {
  const out: number[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if (/\bwithAdmin\b/.test(l)) out.push(i + 1);
  });
  return out;
}

const ROOTS = ['apps', 'packages', 'workers', 'e2e'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', 'coverage', 'test-results', 'playwright-report']);
const EXT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function walk(dir: string, root: string, acc: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, root, acc);
    else if (st.isFile() && EXT.test(name) && !name.endsWith('.d.ts')) acc.push(relative(root, full).split(sep).join('/'));
  }
}

export function scanRepo(root: string): { file: string; line: number }[] {
  const files: string[] = [];
  for (const r of ROOTS) walk(join(root, r), root, files);
  const out: { file: string; line: number }[] = [];
  for (const rel of files.sort()) {
    if (isAllowedPath(rel)) continue;
    for (const line of scanContent(readFileSync(join(root, rel), 'utf8'))) out.push({ file: rel, line });
  }
  return out;
}

if (!process.env.VITEST) {
  const found = scanRepo(process.cwd());
  for (const v of found) console.error(`withadmin-guard: ${v.file}:${v.line} withAdmin outside the allowlist (use withUser)`);
  if (found.length) process.exit(1);
  console.log('withadmin-guard: ok');
}
