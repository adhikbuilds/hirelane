/**
 * `company:logo`: resolve a company's logo and record it on the company row.
 * Fixture mode (default, like ingest) reads the committed logos under packages/ingest/fixtures/logos and never
 * touches the network. Live mode fetches through the SSRF-guarded pipeline in @hirelane/ingest/src/company.
 * No usable logo means logo_path NULL + logo_source 'monogram'; the UI draws the monogram from the name.
 * Registration (outside this file's scope): `...createCompanyTasks()` in tasks/index.ts.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Task, TaskList } from 'graphile-worker';
import { withAdmin } from '@hirelane/db';
import { fetchCompanyLogo, type LogoResult } from '@hirelane/ingest/src/company/logo';
import { createGuardedFetch, systemLookup } from '@hirelane/ingest/src/company/transport';

export interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  logoSource: string | null;
  logoPath: string | null;
}

export interface CompanyDeps {
  mode: () => 'live' | 'fixture';
  load: (id: string) => Promise<CompanyRow | null>;
  save: (id: string, v: { logoPath: string | null; logoSource: 'fetched' | 'fixture' | 'monogram' }) => Promise<void>;
  fixtureLogo: (slug: string) => Buffer | null;
  fetchLogo: (domain: string) => Promise<LogoResult>;
  /** Persists a PNG and returns the stored logo_path. */
  store: (slug: string, png: Buffer) => Promise<string>;
}

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../../../..');
export const DEFAULT_FIXTURE_DIR = join(REPO_ROOT, 'packages/ingest/fixtures/logos');
export const DEFAULT_LOGO_DIR = process.env['HIRELANE_LOGO_DIR'] ?? join(REPO_ROOT, 'storage/logos');

export function createFixtureLogoReader(dir: string = DEFAULT_FIXTURE_DIR): (slug: string) => Buffer | null {
  return (slug) => {
    if (!SAFE_SLUG.test(slug)) return null;
    try {
      return readFileSync(join(dir, `${slug}.png`));
    } catch {
      return null;
    }
  };
}

export function createLogoStore(dir: string = DEFAULT_LOGO_DIR): (slug: string, png: Buffer) => Promise<string> {
  return async (slug, png) => {
    if (!SAFE_SLUG.test(slug)) throw new Error('company:logo: unsafe slug');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${slug}.png`), png);
    return `logos/${slug}.png`;
  };
}

export const defaultCompanyDeps: CompanyDeps = {
  mode: () => (process.env['HIRELANE_INGEST_MODE'] === 'live' ? 'live' : 'fixture'),
  load: (id) =>
    withAdmin(async (c) => {
      const { rows } = await c.query<{ id: string; slug: string; name: string; domain: string | null; logo_source: string | null; logo_path: string | null }>(
        'SELECT id, slug, name, domain, logo_source, logo_path FROM companies WHERE id = $1',
        [id],
      );
      const r = rows[0];
      return r ? { id: r.id, slug: r.slug, name: r.name, domain: r.domain, logoSource: r.logo_source, logoPath: r.logo_path } : null;
    }),
  save: (id, v) =>
    withAdmin(async (c) => {
      await c.query('UPDATE companies SET logo_path = $2, logo_source = $3, updated_at = now() WHERE id = $1', [id, v.logoPath, v.logoSource]);
    }),
  fixtureLogo: createFixtureLogoReader(),
  fetchLogo: (domain) => fetchCompanyLogo(domain, { fetch: createGuardedFetch(), lookup: systemLookup }),
  store: createLogoStore(),
};

export function createCompanyTasks(deps: CompanyDeps = defaultCompanyDeps): TaskList & Record<string, Task> {
  const logo: Task = async (payload, helpers) => {
    const p = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const id = p['companyId'];
    if (typeof id !== 'string' || id.length === 0) throw new Error('company:logo: invalid payload');
    const company = await deps.load(id);
    if (!company) throw new Error(`company:logo: company ${id} not found`);
    if (p['force'] !== true && company.logoPath && (company.logoSource === 'fetched' || company.logoSource === 'fixture')) {
      helpers.logger.info(`company:logo: ${company.slug} already has a ${company.logoSource} logo`);
      return;
    }

    if (deps.mode() === 'fixture') {
      const png = deps.fixtureLogo(company.slug);
      if (png) {
        await deps.save(id, { logoPath: await deps.store(company.slug, png), logoSource: 'fixture' });
        helpers.logger.info(`company:logo: ${company.slug} fixture`);
      } else {
        await deps.save(id, { logoPath: null, logoSource: 'monogram' });
        helpers.logger.info(`company:logo: ${company.slug} monogram (no fixture)`);
      }
      return;
    }

    let reason = 'no_domain';
    if (company.domain) {
      try {
        const r = await deps.fetchLogo(company.domain);
        if (r.ok) {
          await deps.save(id, { logoPath: await deps.store(company.slug, r.png), logoSource: 'fetched' });
          helpers.logger.info(`company:logo: ${company.slug} fetched from ${r.sourceUrl}`);
          return;
        }
        reason = `${r.reason} [${r.attempts.map((a) => a.reason).join(',')}]`;
      } catch {
        reason = 'error'; // never log URLs from the response or error text
      }
    }
    await deps.save(id, { logoPath: null, logoSource: 'monogram' });
    helpers.logger.info(`company:logo: ${company.slug} monogram (${reason})`);
  };

  return { 'company:logo': logo };
}
