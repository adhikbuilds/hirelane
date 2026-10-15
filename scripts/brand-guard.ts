import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface Violation {
  line: number;
  match: string;
}
export interface FileViolation extends Violation {
  file: string;
}

// Banned words are assembled at runtime so this file passes its own scan.
const A = ['short', 'list'].join('');
const B = ['P', 'ip'].join('');
const PATTERNS: RegExp[] = [new RegExp(A, 'gi'), new RegExp(`\\b${B}\\b`, 'g')];

export function scanContent(text: string): Violation[] {
  const out: Violation[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      for (const m of l.matchAll(re)) out.push({ line: i + 1, match: m[0] });
    }
  });
  return out;
}

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git', '.turbo', 'coverage']);

/** Product surfaces: web app, package/worker sources, email templates, public/. */
export function isProductSurface(rel: string): boolean {
  const p = rel.split(sep).join('/');
  if (p.split('/').some((s) => SKIP_DIRS.has(s))) return false;
  return (
    /^apps\/web\//.test(p) ||
    /^packages\/[^/]+\/src\//.test(p) ||
    /^workers\/[^/]+\/src\//.test(p) ||
    /^packages\/[^/]+\/(emails?|templates)\//.test(p) ||
    /^public\//.test(p)
  );
}

function walk(dir: string, root: string, acc: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, root, acc);
    else if (st.isFile()) acc.push(relative(root, full));
  }
}

export function scanRepo(root: string): FileViolation[] {
  const files: string[] = [];
  for (const top of ['apps', 'packages', 'workers', 'public']) walk(join(root, top), root, files);
  const out: FileViolation[] = [];
  for (const rel of files.sort()) {
    if (!isProductSurface(rel)) continue;
    const buf = readFileSync(join(root, rel));
    if (buf.includes(0)) continue; // binary
    for (const v of scanContent(buf.toString('utf8'))) out.push({ file: rel.split(sep).join('/'), ...v });
  }
  return out;
}

// Run as a CLI unless imported by the test runner.
if (!process.env.VITEST) {
  const found = scanRepo(process.cwd());
  for (const v of found) console.error(`brand-guard: ${v.file}:${v.line} banned term "${v.match}"`);
  if (found.length) process.exit(1);
  console.log('brand-guard: ok');
}
