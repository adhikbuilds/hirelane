import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ALLOWLIST, isAllowedPath, scanContent, scanRepo } from '../withadmin-guard';

describe('scanContent', () => {
  it('flags an import and a call', () => {
    expect(scanContent(`import { withAdmin } from "@hirelane/db";\nawait withAdmin(f)`)).toEqual([1, 2]);
  });
  it('ignores unrelated identifiers and withUser', () => {
    expect(scanContent('const withAdminish = 1; withUser(id, f); // plain')).toEqual([]);
  });
});

describe('isAllowedPath', () => {
  it.each([
    'apps/web/app/api/public/_lib/handlers.ts',
    'apps/web/app/jobs/actions.ts',
    'apps/web/app/api/webhooks/inbound-email/route.ts',
    'apps/web/lib/auth/session.ts',
    'apps/web/app/ops/page.tsx',
    'workers/runner/src/tasks/ingest.ts',
    'packages/ingest/src/run/run.ts',
    'packages/db/src/seed.ts',
    'apps/web/tests/sitemap.test.ts',
    'packages/db/test/helpers.ts',
  ])('allows %s', (p) => expect(isAllowedPath(p)).toBe(true));
  it.each([
    'apps/web/app/app/picks/page.tsx',
    'apps/web/app/api/me/route.ts',
    'apps/web/app/api/resumes/route.ts',
    'apps/web/lib/authx/x.ts',
    'packages/agent/src/applications/x.ts',
    'packages/engine/src/x.ts',
    'apps/web/app/apps/page.tsx',
    'apps/web/components/app/x.tsx',
    'apps/web/lib/queries/me.ts',
  ])('rejects %s', (p) => expect(isAllowedPath(p)).toBe(false));
  it('keeps every allowlist entry as a path glob', () => {
    for (const a of ALLOWLIST) expect(a.pattern).toMatch(/^(apps|packages|workers|e2e|\*\*)[/]/);
  });
});

describe('scanRepo', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  function repo(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'wa-'));
    dirs.push(root);
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), body);
    }
    return root;
  }
  it('reports only non-allowlisted files', () => {
    const root = repo({
      'apps/web/app/jobs/a.ts': 'withAdmin(x)',
      'apps/web/app/app/picks/page.tsx': 'import { withAdmin } from "@hirelane/db"',
      'apps/web/node_modules/x/y.ts': 'withAdmin(x)',
    });
    expect(scanRepo(root)).toEqual([{ file: 'apps/web/app/app/picks/page.tsx', line: 1 }]);
  });
});
