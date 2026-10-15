import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface Violation {
  line: number;
  match: string;
  rule: string;
}
export interface FileViolation extends Violation {
  file: string;
}

/**
 * ATS application-submission endpoints. Read-only ingestion endpoints
 * (boards-api jobs list/detail, api.lever.co/v0/postings GET, Ashby posting-api)
 * are intentionally NOT listed. Only packages/agent/src/submit/ may reference these.
 */
export const RULES: { rule: string; re: RegExp }[] = [
  // Greenhouse: hosted/embedded application form (job_app) and application POST API.
  { rule: 'greenhouse job_app', re: /greenhouse\.io[^\s'"`]*job_app/gi },
  { rule: 'greenhouse job_app param', re: /[?&]job_app\b/gi },
  { rule: 'greenhouse applications API', re: /greenhouse\.io\/v1\/boards\/[^\s/'"`]+\/(?:jobs\/[^\s/'"`]+\/)?applications\b/gi },
  // Lever: apply page and apply API.
  { rule: 'lever apply page', re: /jobs\.lever\.co\/[^\s'"`]*\/apply\b/gi },
  { rule: 'lever apply API', re: /api\.lever\.co\/v0\/postings\/[^\s'"`]*\/apply\b/gi },
  // Ashby: application form page and submit endpoints.
  { rule: 'ashby application form', re: /jobs\.ashbyhq\.com\/[^\s'"`]*\/application\b/gi },
  { rule: 'ashby submit API', re: /ashbyhq\.com\/(?:[^\s'"`]*\/)?applicationForm\.submit/gi },
  { rule: 'ashby posting-api application', re: /ashbyhq\.com\/posting-api\/[^\s'"`]*\/application\b/gi },
];

export const ALLOWED_PREFIX = 'packages/agent/src/submit/';

export function scanContent(text: string): Violation[] {
  const out: Violation[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    for (const { rule, re } of RULES) {
      re.lastIndex = 0;
      for (const m of l.matchAll(re)) out.push({ line: i + 1, match: m[0], rule });
    }
  });
  return out;
}

export function isAllowedPath(rel: string): boolean {
  return rel.split(sep).join('/').startsWith(ALLOWED_PREFIX);
}

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', '.turbo', 'coverage', 'docs', 'test-results', 'playwright-report']);
const SKIP_FILES = new Set(['PLAN.md', 'CLAUDE.md', 'scripts/no-submit-guard.ts', 'pnpm-lock.yaml']);

function walk(dir: string, root: string, acc: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, root, acc);
    else if (st.isFile()) acc.push(relative(root, full).split(sep).join('/'));
  }
}

export function scanRepo(root: string): FileViolation[] {
  const files: string[] = [];
  walk(root, root, files);
  const out: FileViolation[] = [];
  for (const rel of files.sort()) {
    if (isAllowedPath(rel) || SKIP_FILES.has(rel)) continue;
    const buf = readFileSync(join(root, rel));
    if (buf.length > 2_000_000 || buf.includes(0)) continue;
    for (const v of scanContent(buf.toString('utf8'))) out.push({ file: rel, ...v });
  }
  return out;
}

// Run as a CLI unless imported by the test runner.
if (!process.env.VITEST) {
  const found = scanRepo(process.cwd());
  for (const v of found) console.error(`no-submit-guard: ${v.file}:${v.line} ${v.rule}: ${v.match}`);
  if (found.length) process.exit(1);
  console.log('no-submit-guard: ok');
}
