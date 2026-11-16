import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const config = require('../../.dependency-cruiser.cjs');

/**
 * Cruises a throwaway tree whose paths match the repo layout, so the real rules from .dependency-cruiser.cjs
 * run end to end. A rule that never fires would pass `pnpm lint:deps` silently, so each rule is proven to fire here.
 */
const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

async function violations(files: Record<string, string>): Promise<string[]> {
  const { cruise } = await import('dependency-cruiser');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hl-depcruise-')));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  const r = await cruise(['packages', 'apps', 'workers'].filter((d) => Object.keys(files).some((f) => f.startsWith(d + '/'))), {
    ruleSet: config,
    validate: true,
    baseDir: root,
    exclude: config.options.exclude,
    doNotFollow: config.options.doNotFollow,
  } as never, undefined, undefined);
  const out = r.output as { summary: { violations: { rule: { name: string }; from: string }[] } };
  return out.summary.violations.filter((v) => v.rule.name !== 'not-in-allowed').map((v) => `${v.rule.name}:${v.from}`);
}

const DB = { 'packages/db/src/index.ts': 'export const x = 1;\n' };
const ENGINE = { 'packages/engine/src/index.ts': 'export const y = 1;\n' };
const SERVICES_OK = { 'packages/services/src/index.ts': 'export const s = 1;\n' };

describe('services-deps', () => {
  it('allows services to import db and engine', async () => {
    const v = await violations({
      ...DB,
      ...ENGINE,
      'packages/services/src/a.ts': "import '../../db/src/index';\nimport '../../engine/src/index';\n",
    });
    expect(v).toEqual([]);
  });
  it('flags services importing a worker, an app or ingest', async () => {
    const v = await violations({
      ...DB,
      'workers/runner/src/w.ts': 'export const w = 1;\n',
      'apps/web/lib/x.ts': 'export const a = 1;\n',
      'packages/ingest/src/i.ts': 'export const i = 1;\n',
      'packages/services/src/a.ts': "import '../../../workers/runner/src/w';\n",
      'packages/services/src/b.ts': "import '../../../apps/web/lib/x';\n",
      'packages/services/src/c.ts': "import '../../ingest/src/i';\n",
    });
    expect(v.filter((x) => x.startsWith('services-deps:')).sort()).toEqual([
      'services-deps:packages/services/src/a.ts',
      'services-deps:packages/services/src/b.ts',
      'services-deps:packages/services/src/c.ts',
    ]);
  });
});

describe('api-v1-thin', () => {
  const V1 = 'apps/web/app/api/v1';
  it('allows services, lib/auth, lib/http and v1 siblings', async () => {
    const v = await violations({
      ...SERVICES_OK,
      'apps/web/lib/auth/index.ts': 'export const a = 1;\n',
      'apps/web/lib/http/index.ts': 'export const h = 1;\n',
      [`${V1}/_lib/util.ts`]: 'export const u = 1;\n',
      [`${V1}/alias/route.ts`]: "import '@/lib/auth/session';\nimport '@/lib/http';\nimport 'next/server';\nimport 'zod';\n",
      [`${V1}/resumes/route.ts`]:
        "import '../../../../../../packages/services/src/index';\nimport '../../../../lib/auth/index';\nimport '../../../../lib/http/index';\nimport '../_lib/util';\n",
    });
    expect(v).toEqual([]);
  });
  it('flags @hirelane/db, other packages, other web modules and workers', async () => {
    const v = await violations({
      ...DB,
      ...ENGINE,
      'apps/web/lib/queries.ts': 'export const q = 1;\n',
      'apps/web/lib/authz.ts': 'export const z = 1;\n',
      'workers/runner/src/w.ts': 'export const w = 1;\n',
      [`${V1}/db/route.ts`]: "import '../../../../../../packages/db/src/index';\n",
      [`${V1}/engine/route.ts`]: "import '../../../../../../packages/engine/src/index';\n",
      [`${V1}/q/route.ts`]: "import '../../../../lib/queries';\n",
      [`${V1}/z/route.ts`]: "import '../../../../lib/authz';\n",
      [`${V1}/w/route.ts`]: "import '../../../../../../workers/runner/src/w';\n",
      [`${V1}/alias/route.ts`]: "import '@/lib/queries';\n",
      [`${V1}/alias2/route.ts`]: "import '@/lib/authz';\nimport '@/components/x';\n",
    });
    expect([...new Set(v.filter((x) => x.startsWith('api-v1-thin:')))].sort()).toEqual(
      ['alias', 'alias2', 'db', 'engine', 'q', 'w', 'z'].map((n) => `api-v1-thin:${V1}/${n}/route.ts`),
    );
  });
});

describe('actions-thin', () => {
  const A = 'apps/web/app/(app)';
  it('allows services and web lib; flags db, engine and workers in a signed-in actions.ts', async () => {
    const v = await violations({
      ...SERVICES_OK,
      ...DB,
      ...ENGINE,
      'apps/web/lib/api/action.ts': 'export const a = 1;\n',
      'workers/runner/src/w.ts': 'export const w = 1;\n',
      [`${A}/ok/actions.ts`]: "import '../../../../../packages/services/src/index';\nimport '../../../lib/api/action';\n",
      [`${A}/db/actions.ts`]: "import '../../../../../packages/db/src/index';\n",
      [`${A}/eng/actions.ts`]: "import '../../../../../packages/engine/src/index';\n",
      [`${A}/w/actions.ts`]: "import '../../../../../workers/runner/src/w';\n",
    });
    expect([...new Set(v.filter((x) => x.startsWith('actions-thin:')))].sort()).toEqual(
      ['db', 'eng', 'w'].map((n) => `actions-thin:${A}/${n}/actions.ts`),
    );
  });
});

describe('extractors-worker-only', () => {
  it('flags each heavy parser outside workers/runner, including packages that are not installed', async () => {
    const bad = ['unpdf', 'pdfjs-dist', 'pdfjs-dist/legacy/build/pdf.mjs', 'fflate', 'pdfkit', 'fontkit'];
    const files: Record<string, string> = {};
    bad.forEach((m, i) => {
      files[`apps/web/lib/p${i}.ts`] = `import '${m}';\n`;
    });
    files['packages/engine/src/q.ts'] = "import 'pdfkit';\n";
    const v = (await violations(files)).filter((x) => x.startsWith('extractors-worker-only:'));
    expect(v).toHaveLength(bad.length + 1);
  });
  it('allows them under workers/runner and ignores lookalike names', async () => {
    const v = await violations({
      'workers/runner/src/resume/e.ts': "import 'unpdf';\nimport 'fflate';\nimport 'pdfkit';\nimport 'fontkit';\nimport 'pdfjs-dist';\n",
      'apps/web/lib/ok.ts': "import 'unpdf-like';\nimport 'my-fflate-utils';\n",
    });
    expect(v.filter((x) => x.startsWith('extractors-worker-only:'))).toEqual([]);
  });
});
