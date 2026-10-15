import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isAllowedPath, scanContent, scanRepo } from '../no-submit-guard';

// Submission references are assembled at runtime so this file stays clean.
const GH = ['https://boards.green', 'house.io/acme/jobs/123?', 'job_', 'app=1'].join('');
const GH_EMBED = ['job-boards.green', 'house.io/embed/', 'job_', 'app'].join('');
const GH_API_APPS = ['boards-api.green', 'house.io/v1/boards/acme/applications'].join('');
const LEVER = ['https://jobs.lev', 'er.co/acme/abc-123/', 'apply'].join('');
const LEVER_API = ['api.lev', 'er.co/v0/postings/acme/abc-123/', 'apply'].join('');
const ASHBY = ['https://jobs.ashby', 'hq.com/acme/abc-123/', 'application'].join('');
const ASHBY_API = ['api.ashby', 'hq.com/applicationForm.', 'submit'].join('');

describe('scanContent', () => {
  it.each([GH, GH_EMBED, GH_API_APPS, LEVER_API, ASHBY_API])(
    'fails on %s',
    (s) => {
      const v = scanContent(`fetch("${s}", { method: "POST" })`);
      expect(v.length).toBeGreaterThan(0);
      expect(v[0].line).toBe(1);
    },
  );
  it('passes read-only ingestion endpoints', () => {
    const ok = [
      'https://boards-api.green' + 'house.io/v1/boards/acme/jobs?content=true',
      'https://boards-api.green' + 'house.io/v1/boards/acme/jobs/123',
      'https://api.lev' + 'er.co/v0/postings/acme?mode=json',
      'https://api.ashby' + 'hq.com/posting-api/job-board/acme',
      'the pipeline applies filters',
      // Human-facing application pages are the handoff target, not submission endpoints.
      LEVER,
      ASHBY,
      '',
    ].join('\n');
    expect(scanContent(ok)).toEqual([]);
  });
  it('is case-insensitive on hosts and reports line numbers', () => {
    expect(scanContent(`a\n${LEVER_API.toUpperCase()}`)[0].line).toBe(2);
  });
});

describe('isAllowedPath', () => {
  it('allows only packages/agent/src/submit/', () => {
    expect(isAllowedPath('packages/agent/src/submit/greenhouse.ts')).toBe(true);
    expect(isAllowedPath('packages/agent/src/other.ts')).toBe(false);
    expect(isAllowedPath('packages/agent/src/submitter/x.ts')).toBe(false);
    expect(isAllowedPath('apps/web/a.ts')).toBe(false);
  });
});

describe('scanRepo', () => {
  let root = '';
  afterEach(() => root && rmSync(root, { recursive: true, force: true }));
  const put = (rel: string, body: string) => {
    const f = join(root, rel);
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, body);
  };
  it('flags references outside the submit dir only', () => {
    root = mkdtempSync(join(tmpdir(), 'nosubmit-'));
    put('packages/agent/src/submit/gh.ts', LEVER_API);
    put('apps/web/lib/x.ts', LEVER_API);
    put('workers/w/src/y.ts', ASHBY_API);
    put('node_modules/z/index.js', LEVER_API);
    put('docs/notes.md', LEVER_API);
    put('apps/web/lib/handoff.ts', LEVER);
    put('packages/a/src/ok.ts', 'export const a = 1');
    const files = scanRepo(root).map((r) => r.file).sort();
    expect(files).toEqual(['apps/web/lib/x.ts', 'workers/w/src/y.ts']);
  });
  it('returns nothing for an empty tree', () => {
    root = mkdtempSync(join(tmpdir(), 'nosubmit-'));
    expect(scanRepo(root)).toEqual([]);
  });
});
