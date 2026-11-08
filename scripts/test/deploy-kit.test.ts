import { beforeAll, describe, expect, it } from 'vitest';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';

/** Guards for the public demo deploy kit (docs/DEPLOY-DEMO.md). Synthetic data only; these tests never touch a network service. */

const ROOT = resolve(import.meta.dirname, '../..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const SMOKE = join(ROOT, 'scripts/demo-smoke.sh');

/** Keys that must exist in .env.production.example. Anything the production web app or worker cannot run without. */
const REQUIRED_KEYS = [
  'NODE_ENV',
  'DATABASE_URL',
  'HIRELANE_MASTER_KEY',
  'HIRELANE_OPS_TOKEN',
  'HIRELANE_APP_ORIGIN',
  'APP_ORIGIN',
  'HIRELANE_APPLY_DOMAIN',
  'HIRELANE_MAIL_AUTHSERV_ID',
  'HIRELANE_STORAGE_DIR',
  'HIRELANE_AUTO_APPLY',
  'HIRELANE_LLM_MODE',
  'ANTHROPIC_API_KEY',
  'HIRELANE_INGEST_MODE',
  'HIRELANE_ACCOUNTS',
  'TRUST_PROXY_HOPS',
  'TRUST_X_REAL_IP',
];

/** Non-secret policy values the demo must carry. Any other non-empty value in the template is a failure. */
const FIXED_VALUES: Record<string, string> = {
  NODE_ENV: 'production',
  HIRELANE_AUTO_APPLY: 'fixture',
  HIRELANE_LLM_MODE: 'off',
  HIRELANE_INGEST_MODE: 'fixture',
  TRUST_PROXY_HOPS: '1',
  TRUST_X_REAL_IP: '1',
};

/** Switches that must never be set in production, even to an empty-looking value that would be read as on. */
const NEVER_UNCOMMENTED = ['HIRELANE_DEMO', 'HIRELANE_SAMPLES', 'HIRELANE_INSECURE_DEV_COOKIE', 'HIRELANE_FAULTS'];

const SKIP_DIRS = new Set(['node_modules', '.next', 'test', 'tests', 'e2e', 'e2e-support', 'dist', 'coverage']);

function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!m) throw new Error(`unparseable line in .env.production.example: ${line}`);
    if (out.has(m[1]!)) throw new Error(`duplicate key ${m[1]}`);
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|mts|js)$/.test(name) && !/\.test\./.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
}

function productionSource(): string {
  const files: string[] = [];
  for (const d of ['apps/web', 'packages', 'workers/runner/src', 'scripts']) walk(join(ROOT, d), files);
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

describe('deploy kit: .env.production.example', () => {
  const example = parseEnv(read('.env.production.example'));

  it('lists every variable the production app needs', () => {
    const missing = REQUIRED_KEYS.filter((k) => !example.has(k));
    expect(missing).toEqual([]);
  });

  it('lists only variables the code actually reads (no stale names)', () => {
    const src = productionSource();
    const unread = [...example.keys()].filter((k) => !new RegExp(`\\b${k}\\b`).test(src));
    expect(unread).toEqual([]);
  });

  it('carries no secret: every non-empty value is one of the fixed, non-secret policy values', () => {
    const offenders = [...example.entries()].filter(([k, v]) => v !== '' && FIXED_VALUES[k] !== v);
    expect(offenders).toEqual([]);
  });

  it('carries every fixed policy value exactly', () => {
    for (const [k, v] of Object.entries(FIXED_VALUES)) expect(example.get(k)).toBe(v);
  });

  it('never enables a dev, sample, fault or demo switch in production', () => {
    for (const k of NEVER_UNCOMMENTED) expect(example.has(k)).toBe(false);
  });

  it('keeps the LLM key empty (the demo makes 0 LLM calls)', () => {
    expect(example.get('ANTHROPIC_API_KEY')).toBe('');
  });

  it('is not hidden by .gitignore (the file must be committable)', () => {
    const r = spawnSync('git', ['check-ignore', '-q', '.env.production.example'], { cwd: ROOT });
    expect(r.status).toBe(1);
  });
});

describe('deploy kit: worker container image', () => {
  it('builds from the workspace with a frozen lockfile and runs as the unprivileged node user', () => {
    const df = read('workers/runner/Dockerfile');
    expect(df).toMatch(/^FROM node:22/m);
    expect(df).toContain('pnpm install --frozen-lockfile');
    expect(df).toMatch(/^USER node$/m);
    expect(df).toContain('"src/index.ts"');
  });

  it('never copies an env file into the image', () => {
    const df = read('workers/runner/Dockerfile');
    expect(df).not.toMatch(/^(COPY|ADD)\s.*\.env/m);
  });

  it('excludes secrets, local state and dependencies from the build context', () => {
    const ignore = read('workers/runner/Dockerfile.dockerignore')
      .split('\n')
      .map((l) => l.trim());
    expect(ignore).toContain('**/.env*');
    expect(ignore).toContain('**/node_modules');
    expect(ignore).toContain('storage');
  });
});

describe('deploy kit: Fly.io worker template', () => {
  let fly = '';
  beforeAll(() => {
    fly = read('workers/runner/fly.toml.template');
  });

  it('points at the runner Dockerfile that exists', () => {
    expect(fly).toMatch(/dockerfile = "workers\/runner\/Dockerfile"/);
    expect(existsSync(join(ROOT, 'workers/runner/Dockerfile'))).toBe(true);
  });

  it('is a worker, not a web service (no HTTP service block)', () => {
    expect(fly).not.toContain('[http_service]');
  });

  it('holds no secret: secrets go through fly secrets, never this file', () => {
    expect(fly).not.toMatch(/postgres:\/\//);
    for (const secret of ['DATABASE_URL', 'HIRELANE_MASTER_KEY', 'ANTHROPIC_API_KEY', 'HIRELANE_OPS_TOKEN', 'LINKEDIN_CLIENT_SECRET', 'HIRELANE_GOOGLE_CLIENT_SECRET']) {
      expect(fly).not.toMatch(new RegExp(`^\\s*${secret}\\s*=`, 'm'));
    }
  });

  it('pins the demo policy: fixture auto-apply, LLM off, fixture ingest', () => {
    expect(fly).toMatch(/HIRELANE_AUTO_APPLY = "fixture"/);
    expect(fly).toMatch(/HIRELANE_LLM_MODE = "off"/);
    expect(fly).toMatch(/HIRELANE_INGEST_MODE = "fixture"/);
  });
});

describe('deploy kit: Vercel project config', () => {
  it('installs and builds the web workspace from the repository root', () => {
    const v = JSON.parse(read('apps/web/vercel.json')) as Record<string, string>;
    expect(v['framework']).toBe('nextjs');
    expect(v['installCommand']).toContain('pnpm install --frozen-lockfile');
    expect(v['buildCommand']).toContain('pnpm --filter @hirelane/web build');
  });

  it('holds no secret or connection string', () => {
    expect(read('apps/web/vercel.json')).not.toMatch(/postgres|MASTER_KEY|SECRET|TOKEN/);
  });
});

describe('scripts/demo-smoke.sh', () => {
  type Route = { status: number; body?: string; headers?: Record<string, string> };

  const OK: Route = { status: 200, body: 'ok' };
  const healthy = (): Record<string, Route> => ({
    '/': { status: 200, body: '<html>Hirelane</html>', headers: { 'x-frame-options': 'DENY' } },
    '/api/health': { status: 200, body: '{"ok":true}' },
    '/jobs': OK,
    '/colleges': OK,
    '/students': OK,
    '/companies': OK,
    '/about': OK,
    '/how-it-works': OK,
    '/privacy': OK,
    '/terms': OK,
    '/status': OK,
    '/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' },
    '/sitemap.xml': { status: 200, body: '<urlset><loc>https://demo.example.com/jobs</loc></urlset>' },
    '/openapi.json': { status: 200, body: '{"openapi":"3.1.0"}' },
    '/api/public/jobs': { status: 200, body: '{"jobs":[]}' },
    '/api/public/stats/autopilot': OK,
    '/dev/ui': { status: 404 },
    '/dev/campus': { status: 404 },
  });

  async function withServer(routes: Record<string, Route>, fn: (origin: string) => Promise<void>): Promise<void> {
    const server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0]!;
      const r = routes[path] ?? { status: 404, body: 'not found' };
      res.writeHead(r.status, { 'content-type': 'text/plain', ...(r.headers ?? {}) });
      res.end(r.body ?? '');
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
    const port = (server.address() as AddressInfo).port;
    try {
      await fn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  }

  function runSmoke(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
    return new Promise((done) => {
      execFile('bash', [SMOKE, ...args], { timeout: 60_000, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
        done({ code, out: `${stdout}${stderr}` });
      });
    });
  }

  it('is valid bash', () => {
    expect(spawnSync('bash', ['-n', SMOKE]).status).toBe(0);
  });

  it('exits 2 with usage when no origin is given', async () => {
    const r = await runSmoke([]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('usage');
  });

  it('refuses an origin that is not http or https', async () => {
    const r = await runSmoke(['ftp://demo.example.com']);
    expect(r.code).toBe(2);
  });

  it('passes every check against a healthy origin', async () => {
    await withServer(healthy(), async (origin) => {
      const r = await runSmoke([origin]);
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain('0 failed');
    });
  });

  it('fails when a page is broken', async () => {
    await withServer({ ...healthy(), '/jobs': { status: 500 } }, async (origin) => {
      const r = await runSmoke([origin]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('FAIL /jobs');
    });
  });

  it('fails when the dev gallery is reachable in production', async () => {
    await withServer({ ...healthy(), '/dev/ui': { status: 200, body: 'gallery' } }, async (origin) => {
      const r = await runSmoke([origin]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('FAIL /dev/ui');
    });
  });

  it('fails when the sitemap points at localhost (APP_ORIGIN unset in production)', async () => {
    await withServer({ ...healthy(), '/sitemap.xml': { status: 200, body: '<loc>http://localhost:3001/jobs</loc>' } }, async (origin) => {
      const r = await runSmoke([origin]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('FAIL /sitemap.xml');
    });
  });

  it('fails when the health route does not report ok', async () => {
    await withServer({ ...healthy(), '/api/health': { status: 200, body: '{"ok":false}' } }, async (origin) => {
      const r = await runSmoke([origin]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('FAIL /api/health');
    });
  });

  it('checks a job page when the public feed has a job', async () => {
    const routes = { ...healthy(), '/api/public/jobs': { status: 200, body: '{"jobs":[{"slug":"acme-engineer"}]}' } };
    await withServer({ ...routes, '/job/acme-engineer': OK }, async (origin) => {
      const r = await runSmoke([origin]);
      expect(r.code, r.out).toBe(0);
    });
    await withServer({ ...routes, '/job/acme-engineer': { status: 500 } }, async (origin) => {
      const r = await runSmoke([origin]);
      expect(r.code).toBe(1);
      expect(r.out).toContain('FAIL /job/acme-engineer');
    });
  });

  it('adds the sign-in checks only with SMOKE_ACCOUNTS=1', async () => {
    await withServer(healthy(), async (origin) => {
      expect((await runSmoke([origin])).code).toBe(0);
      const r = await runSmoke([origin], { SMOKE_ACCOUNTS: '1' });
      expect(r.code).toBe(1);
      expect(r.out).toContain('FAIL /signin');
    });
    await withServer({ ...healthy(), '/signin': OK, '/api/v1/openapi.json': OK }, async (origin) => {
      const r = await runSmoke([origin], { SMOKE_ACCOUNTS: '1' });
      expect(r.code, r.out).toBe(0);
    });
  });
});
