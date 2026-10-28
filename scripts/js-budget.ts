import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * `pnpm budget`: builds apps/web and measures the gzip size of first-load JS for each student route
 * (PLAN Amendment B section 12: at most 100 KB per route, 1 KB = 1000 bytes as Next prints it).
 *
 * The build runs in a throwaway mirror of apps/web under the OS temp dir, so it never rewrites apps/web/.next
 * (a running `next dev` keeps working). Pass --in-place to build in apps/web itself, --no-build to only measure
 * an existing .next (set --dir to its apps/web). A route that is not built yet is reported "not built" and does not
 * fail the budget; pass --require to fail on it.
 */
export const LIMIT_BYTES = 100_000;

/** Routes under budget. A trailing /* matches the route and everything below it. */
export const BUDGET_ROUTES = ['/signin', '/signin/code', '/welcome', '/you', '/you/eligibility', '/resume/*'];

export type Manifest = { pages: Record<string, string[]> };
export interface RouteRow {
  route: string;
  /** Matched manifest page, or null when the route is not built. */
  page: string | null;
  files: number;
  bytes: number;
  status: 'ok' | 'over' | 'not built';
}

/** "/(auth)/signin/code/page" -> "/signin/code". Route groups and the page leaf are not part of the URL. */
export function normalizePage(key: string): string {
  const parts = key.split('/').filter((p) => p && !/^\(.*\)$/.test(p) && !p.startsWith('@'));
  if (parts[parts.length - 1] === 'page') parts.pop();
  return '/' + parts.join('/');
}

export const gzipBytes = (buf: Buffer): number => gzipSync(buf, { level: 9 }).length;

/** Unique .js files of a page, summed after gzip. CSS and source maps are not counted. */
export function firstLoadBytes(files: string[], read: (file: string) => Buffer): { files: number; bytes: number } {
  const js = [...new Set(files.filter((f) => f.endsWith('.js')))];
  return { files: js.length, bytes: js.reduce((n, f) => n + gzipBytes(read(f)), 0) };
}

export function measure(manifest: Manifest, read: (file: string) => Buffer, routes = BUDGET_ROUTES, limit = LIMIT_BYTES): RouteRow[] {
  const byUrl = new Map<string, string[]>();
  for (const [key, files] of Object.entries(manifest.pages)) {
    if (key.endsWith('/page')) byUrl.set(normalizePage(key), files);
  }
  const rows: RouteRow[] = [];
  for (const route of routes) {
    const wild = route.endsWith('/*');
    const base = wild ? route.slice(0, -2) : route;
    const hits = [...byUrl.keys()].filter((u) => (wild ? u === base || u.startsWith(base + '/') : u === base)).sort();
    if (hits.length === 0) {
      rows.push({ route, page: null, files: 0, bytes: 0, status: 'not built' });
      continue;
    }
    for (const page of hits) {
      const m = firstLoadBytes(byUrl.get(page)!, read);
      rows.push({ route: wild ? page : route, page, ...m, status: m.bytes > limit ? 'over' : 'ok' });
    }
  }
  return rows;
}

export const kb = (n: number): string => `${(n / 1000).toFixed(1)} kB`;

export function render(rows: RouteRow[], shared: { files: number; bytes: number } | null, limit = LIMIT_BYTES, reference: RouteRow | null = null): string {
  const w = Math.max(...rows.map((r) => r.route.length), 5);
  const lines = [`${'route'.padEnd(w)}  first-load JS (gzip)  files  status`];
  for (const r of rows) lines.push(`${r.route.padEnd(w)}  ${(r.status === 'not built' ? '-' : kb(r.bytes)).padStart(20)}  ${String(r.files || '-').padStart(5)}  ${r.status}`);
  lines.push(`budget: ${kb(limit)} per route`);
  if (shared) lines.push(`chunks shared by every measured route: ${kb(shared.bytes)} in ${shared.files} files`);
  if (reference && reference.page) lines.push(`reference, ${reference.route} (static page, no student UI): ${kb(reference.bytes)}. That is the Next + React floor on this build; a route cannot go below it.`);
  return lines.join('\n');
}

/** Files every measured page loads: the intersection of their file lists (not the framework floor; see `reference`). */
export function sharedFloor(manifest: Manifest, read: (file: string) => Buffer, rows: RouteRow[]): { files: number; bytes: number } | null {
  const lists = rows.filter((r) => r.page).map((r) => manifest.pages[Object.keys(manifest.pages).find((k) => k.endsWith('/page') && normalizePage(k) === r.page)!]!.filter((f) => f.endsWith('.js')));
  if (lists.length === 0) return null;
  const common = lists[0]!.filter((f) => lists.every((l) => l.includes(f)));
  return firstLoadBytes(common, read);
}

function portInUse(port: number): boolean {
  try {
    execFileSync('lsof', ['-iTCP:' + port, '-sTCP:LISTEN', '-t'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** A copy of apps/web (sources only) inside a temp tree whose node_modules and workspace packages are symlinks to the real ones. */
function mirror(root: string): string {
  const dir = join(tmpdir(), 'hirelane-budget');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'apps'), { recursive: true });
  for (const l of ['node_modules', 'packages', 'workers']) symlinkSync(join(root, l), join(dir, l));
  for (const f of ['package.json', 'pnpm-workspace.yaml']) if (existsSync(join(root, f))) cpSync(join(root, f), join(dir, f));
  const skip = new Set(['node_modules', '.next', 'tests', 'e2e-support', 'tsconfig.tsbuildinfo']);
  cpSync(join(root, 'apps/web'), join(dir, 'apps/web'), { recursive: true, filter: (src) => !skip.has(src.split('/').pop()!) || src === join(root, 'apps/web') });
  symlinkSync(join(root, 'apps/web/node_modules'), join(dir, 'apps/web/node_modules'));
  return join(dir, 'apps/web');
}

function main(argv: string[]): number {
  const root = resolve(import.meta.dirname, '..');
  const flag = (f: string) => argv.includes(f);
  const dirArg = argv.find((a) => a.startsWith('--dir='))?.slice(6);
  let web = dirArg ? resolve(dirArg) : join(root, 'apps/web');

  if (!flag('--no-build')) {
    const inPlace = flag('--in-place');
    if (inPlace && portInUse(3001)) console.warn('warning: something is listening on :3001; --in-place rewrites apps/web/.next under it');
    web = inPlace ? join(root, 'apps/web') : mirror(root);
    console.log(`building ${inPlace ? 'in place' : 'in an isolated mirror'}: ${web}`);
    // Pages that read the database at build time need a URL; the local compose default is only used when none is set.
    const env = { ...process.env, DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgres://hirelane:hirelane@localhost:5433/hirelane_test', NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production' as const };
    execFileSync(join(root, 'apps/web/node_modules/.bin/next'), ['build'], { cwd: web, env, stdio: ['ignore', 'ignore', 'inherit'], timeout: 10 * 60_000 });
  }

  const manifestPath = join(web, '.next/app-build-manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`no ${manifestPath}; build first`);
    return 2;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const read = (f: string) => readFileSync(join(web, '.next', f));
  const rows = measure(manifest, read);
  const reference = measure(manifest, read, ['/terms'])[0] ?? null;
  console.log(render(rows, sharedFloor(manifest, read, rows), LIMIT_BYTES, reference));
  const over = rows.filter((r) => r.status === 'over');
  const missing = rows.filter((r) => r.status === 'not built');
  if (missing.length) console.log(`not built yet: ${missing.map((r) => r.route).join(', ')}${flag('--require') ? ' (failing: --require)' : ''}`);
  if (over.length) console.error(`FAIL: ${over.length} route(s) over ${kb(LIMIT_BYTES)}: ${over.map((r) => r.route).join(', ')}`);
  return over.length || (flag('--require') && missing.length) ? 1 : 0;
}

if (!process.env['VITEST']) process.exit(main(process.argv.slice(2)));
