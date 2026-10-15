import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { findSchemaDrift } from '../src/verify-schema-lib.js';
import { insertJob, refreshJobLifecycle, replaceRequirements, updateJob, type JobWrite } from '../src/enrich/index.js';
import { freshTestClient } from './helpers.js';

function job(over: Partial<JobWrite> = {}): JobWrite {
  return {
    companyId: '', slug: 'acme-data-engineer-aaaaaa', title: 'Data Engineer', titleNorm: 'data engineer',
    roleFamily: 'data-engineer', level: 'mid', workplace: 'remote', employment: 'fulltime', remote: true,
    remoteScope: 'worldwide', countries: [], locations: [], visa: 'unknown', descriptionMd: 't', descriptionText: 't',
    docHash: 'abcd', salary: null, salaryStated: false, skills: ['python'], simhash: '-5', tokenCount: 10, traces: {},
    llmEligibility: null, postedAt: null, enrichVersion: 1, primaryPostingId: null, source: 'fixture', ...over,
  };
}

describe('public board schema (0005)', () => {
  let client: Client;
  let companyId: string;

  beforeAll(async () => {
    client = await freshTestClient();
    await applyMigrations(client, resolve(import.meta.dirname, '../migrations'));
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query('TRUNCATE jobs, postings, company_boards, companies, skills CASCADE');
    companyId = (await client.query<{ id: string }>(`INSERT INTO companies (slug, name) VALUES ('acme', 'Acme Labs') RETURNING id`)).rows[0]!.id;
    await client.query(`INSERT INTO skills (id, label, category) VALUES ('python', 'Python', 'language')`);
  });

  it('has no drift against the Drizzle schema', async () => {
    expect(await findSchemaDrift(client)).toEqual([]);
  });

  it('job_search_text lower-cases title, company name, skill label and id', async () => {
    const { rows } = await client.query(`SELECT job_search_text('Data Engineer', $1, ARRAY['python']) AS t`, [companyId]);
    expect(rows[0].t).toBe('data engineer acme labs python python');
  });

  it('insertJob and updateJob write search_text and content_updated_at', async () => {
    const id = await insertJob(client, job({ companyId }));
    let r = (await client.query('SELECT search_text, content_updated_at FROM jobs WHERE id = $1', [id])).rows[0];
    expect(r.search_text).toContain('acme labs');
    expect(r.search_text).toContain('data engineer');
    await client.query(`UPDATE jobs SET content_updated_at = '2020-01-01'`);
    await updateJob(client, id, job({ companyId, title: 'Analytics Engineer' }));
    r = (await client.query('SELECT search_text, content_updated_at FROM jobs WHERE id = $1', [id])).rows[0];
    expect(r.search_text).toContain('analytics engineer');
    expect(r.content_updated_at.getFullYear()).toBeGreaterThan(2020);
  });

  it('replaceRequirements bumps content_updated_at', async () => {
    const id = await insertJob(client, job({ companyId }));
    await client.query(`UPDATE jobs SET content_updated_at = '2020-01-01'`);
    await replaceRequirements(client, id, []);
    const r = (await client.query('SELECT content_updated_at FROM jobs WHERE id = $1', [id])).rows[0];
    expect(r.content_updated_at.getFullYear()).toBeGreaterThan(2020);
  });

  it('a last_seen_at-only lifecycle change does not bump content_updated_at, a close does', async () => {
    const { rows: b } = await client.query(`INSERT INTO company_boards (company_id, ats, token) VALUES ($1, 'greenhouse', 'acme') RETURNING id`, [companyId]);
    const { rows: p } = await client.query(
      `INSERT INTO postings (board_id, external_id, key, url, title, raw, content_hash, first_seen_at, last_seen_at, source)
       VALUES ($1, 'e1', 'greenhouse:acme:e1', 'https://x.test/1', 'Data Engineer', '{}', 'h', '2026-01-01', '2026-01-02', 'fixture') RETURNING id`,
      [b[0].id],
    );
    const id = await insertJob(client, job({ companyId, primaryPostingId: p[0].id }));
    await client.query('UPDATE postings SET job_id = $1', [id]);
    await refreshJobLifecycle(client);
    await client.query(`UPDATE jobs SET content_updated_at = '2020-01-01'`);
    await client.query(`UPDATE postings SET last_seen_at = '2026-01-03'`);
    await refreshJobLifecycle(client);
    let r = (await client.query('SELECT last_seen_at, content_updated_at FROM jobs WHERE id = $1', [id])).rows[0];
    expect(r.last_seen_at.toISOString()).toBe('2026-01-03T00:00:00.000Z');
    expect(r.content_updated_at.getFullYear()).toBe(2020);
    await client.query(`UPDATE postings SET closed_at = '2026-02-01'`);
    await refreshJobLifecycle(client);
    r = (await client.query('SELECT closed_at, content_updated_at FROM jobs WHERE id = $1', [id])).rows[0];
    expect(r.closed_at).not.toBeNull();
    expect(r.content_updated_at.getFullYear()).toBeGreaterThan(2020);
  });

  describe('job_facets', () => {
    async function open(slug: string, over: Partial<JobWrite>): Promise<string> {
      return insertJob(client, job({ companyId, slug, ...over }));
    }
    const fx = async (k: string) =>
      (await client.query<{ n: number }>('SELECT n FROM job_facets WHERE k = $1', [k])).rows[0]?.n;

    it('counts each open job once per grain, even with several countries', async () => {
      await open('a', { roleFamily: 'data-engineer', countries: ['IN', 'US'], remote: true });
      await open('b', { roleFamily: 'data-engineer', countries: ['IN'], remote: false, workplace: 'onsite' });
      await open('c', { roleFamily: null, countries: ['IN'], remote: false });
      const closed = await open('d', { roleFamily: 'data-engineer', countries: ['IN'] });
      await client.query(`UPDATE jobs SET closed_at = now() WHERE id = $1`, [closed]);
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY job_facets');
      expect(await fx('all:*:*')).toBe(3);
      expect(await fx('role:data-engineer:*')).toBe(2);
      expect(await fx('country:*:IN')).toBe(3);
      expect(await fx('country:*:US')).toBe(1);
      expect(await fx('role_country:data-engineer:IN')).toBe(2);
      expect(await fx('remote_role:data-engineer:*')).toBe(1);
      expect(await fx('remote:*:*')).toBe(1);
    });

    it('is selectable by hirelane_app', async () => {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE hirelane_app');
      await expect(client.query('SELECT count(*) FROM job_facets')).resolves.toBeDefined();
      await client.query('ROLLBACK');
    });
  });
});

describe('search_text maintenance', () => {
  let client: Client;
  beforeAll(async () => {
    client = await freshTestClient();
    await applyMigrations(client, resolve(import.meta.dirname, '../migrations'));
  });
  afterAll(async () => {
    await client.end();
  });

  it('rebuildSearchText follows a company rename and a skill relabel; refreshJobFacets (plain and concurrent) works', async () => {
    const { rebuildSearchText, refreshJobFacets, seedSkills } = await import('../src/enrich/index.js');
    const cid = (await client.query<{ id: string }>(`INSERT INTO companies (slug, name) VALUES ('zed', 'Zed Co') RETURNING id`)).rows[0]!.id;
    await client.query(`INSERT INTO skills (id, label, category) VALUES ('python', 'Python', 'language')`);
    const id = await insertJob(client, job({ companyId: cid, slug: 'zed-1' }));
    await client.query(`UPDATE companies SET name = 'Zed Systems'`);
    expect(await rebuildSearchText(client, cid)).toBe(1);
    expect(await rebuildSearchText(client, cid)).toBe(0);
    expect((await client.query('SELECT search_text FROM jobs WHERE id = $1', [id])).rows[0].search_text).toContain('zed systems');
    await seedSkills(client, [{ id: 'python', label: 'Python Lang', aliases: [], category: 'language', adjacent: [] }]);
    expect((await client.query('SELECT search_text FROM jobs WHERE id = $1', [id])).rows[0].search_text).toContain('python lang');
    await refreshJobFacets(client);
    await refreshJobFacets(client, { concurrently: true });
    expect((await client.query(`SELECT n FROM job_facets WHERE k = 'all:*:*'`)).rows[0].n).toBe(1);
  });
});
