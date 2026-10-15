import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isProductSurface, scanContent, scanRepo } from '../brand-guard';

// Banned words are built at runtime so this file stays clean.
const SHORT = ['short', 'list'].join('');
const SHORT_APP = ['short', 'list', 'app'].join('');
const PIP = ['P', 'ip'].join('');

describe('scanContent', () => {
  it('passes "pipeline"', () => {
    expect(scanContent('the pipeline is green')).toEqual([]);
  });
  it('fails "Pip drafts"', () => {
    const v = scanContent(`${PIP} drafts`);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ line: 1, match: PIP });
  });
  it('treats Pip as case-sensitive', () => {
    expect(scanContent('pip install, PIP, pipe')).toEqual([]);
  });
  it('fails the brand name case-insensitively', () => {
    expect(scanContent(SHORT.toUpperCase())).toHaveLength(1);
    expect(scanContent(`Visit ${SHORT_APP}.co`)).toHaveLength(1);
  });
  it('reports correct line numbers and handles empty input', () => {
    expect(scanContent('')).toEqual([]);
    expect(scanContent(`ok\nok\n${SHORT}`)[0].line).toBe(3);
  });
  it('catches Pip with punctuation boundaries', () => {
    expect(scanContent(`"${PIP}"`)).toHaveLength(1);
    expect(scanContent(`${PIP}'s`)).toHaveLength(1);
  });
});

describe('isProductSurface', () => {
  it.each([
    'apps/web/app/page.tsx',
    'packages/engine/src/a.ts',
    'workers/ingest/src/x.ts',
    'public/logo.svg',
    'packages/email/templates/welcome.html',
    'apps/web/emails/welcome.tsx',
  ])('includes %s', (p) => expect(isProductSurface(p)).toBe(true));
  it.each([
    'docs/recon/notes.md',
    'PLAN.md',
    'CLAUDE.md',
    'scripts/brand-guard.ts',
    'packages/engine/test/a.test.ts',
    'apps/web/node_modules/x/index.js',
  ])('excludes %s', (p) => expect(isProductSurface(p)).toBe(false));
});

describe('scanRepo', () => {
  let root = '';
  afterEach(() => root && rmSync(root, { recursive: true, force: true }));
  const put = (rel: string, body: string) => {
    const f = join(root, rel);
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, body);
  };
  it('flags product files, ignores docs, PLAN.md and CLAUDE.md', () => {
    root = mkdtempSync(join(tmpdir(), 'brand-'));
    put('apps/web/page.tsx', `<h1>${PIP} drafts</h1>`);
    put('docs/recon/notes.md', SHORT);
    put('PLAN.md', SHORT_APP);
    put('CLAUDE.md', SHORT);
    put('packages/a/src/ok.ts', 'const pipeline = 1');
    const res = scanRepo(root);
    expect(res.map((r) => r.file)).toEqual(['apps/web/page.tsx']);
  });
  it('returns nothing for a clean tree and tolerates missing dirs', () => {
    root = mkdtempSync(join(tmpdir(), 'brand-'));
    expect(scanRepo(root)).toEqual([]);
  });
});
