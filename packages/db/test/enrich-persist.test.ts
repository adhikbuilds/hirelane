import { resolve } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrator.js';
import { findSchemaDrift } from '../src/verify-schema-lib.js';
import {
  findClusterCandidates,
  insertJob,
  linkPosting,
  listPendingCompanies,
  loadFxSnapshot,
  loadPendingPostings,
  refreshJobLifecycle,
  replaceRequirements,
  seedFxRates,
  seedSkills,
  updateJob,
  type JobWrite,
} from '../src/enrich/index.js';
import { freshTestClient } from './helpers.js';

const trace = { engineVersion: '1.0.0', subject: 'salary', outcome: 'value', steps: [] };

function job(over: Partial<JobWrite> = {}): JobWrite {
  return {
    companyId: '',
    slug: 'acme-engineer-aaaaaa',
    title: 'Engineer',
    titleNorm: 'engineer',
    roleFamily: 'software-engineer-general',
    level: 'mid',
    workplace: 'remote',
    employment: 'fulltime',
    remote: true,
    remoteScope: 'worldwide',
    countries: [],
    locations: [],
    visa: 'unknown',
    descriptionMd: 'text',
    descriptionText: 'text',
    docHash: 'abcd',
    salary: null,
    salaryStated: false,
    skills: ['python'],
    simhash: '-5',
    tokenCount: 120,
    traces: {},
    llmEligibility: null,
    postedAt: null,
    enrichVersion: 1,
    primaryPostingId: null,
    source: 'fixture',
    ...over,
  };
}

describe('enrichment persistence', () => {
  let client: Client;
  let companyId: string;
  let boardId: string;
  let n = 0;

  async function posting(opts: { closed?: boolean; seen?: string; hash?: string } = {}): Promise<string> {
    n++;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO postings (board_id, external_id, key, url, title, raw, content_hash, first_seen_at, last_seen_at, closed_at, source)
       VALUES ($1, $2, $3, 'https://x.test/' || $2, 'Engineer', '{}', $4, $5, $5, $6, 'fixture') RETURNING id`,
      [boardId, `e${n}`, `greenhouse:acme:e${n}`, opts.hash ?? 'v1:h', opts.seen ?? '2026-01-01T00:00:00Z', opts.closed ? '2026-02-01T00:00:00Z' : null],
    );
    return rows[0]!.id;
  }

  beforeAll(async () => {
    client = await freshTestClient();
    await applyMigrations(client, resolve(import.meta.dirname, '../migrations'));
  });
  afterAll(async () => {
    await client.end();
  });
  beforeEach(async () => {
    await client.query('TRUNCATE jobs, postings, company_boards, companies, skills, fx_rates CASCADE');
    companyId = (await client.query<{ id: string }>(`INSERT INTO companies (slug, name) VALUES ('acme', 'Acme') RETURNING id`)).rows[0]!.id;
    boardId = (await client.query<{ id: string }>(`INSERT INTO company_boards (company_id, ats, token) VALUES ($1, 'greenhouse', 'acme') RETURNING id`, [companyId])).rows[0]!.id;
  });

  it('matches the Drizzle definitions', async () => {
    const drift = await findSchemaDrift(client);
    expect(drift).toEqual([]);
  });

  it('seeds skills and fx rates idempotently and reads the snapshot back', async () => {
    const defs = [
      { id: 'python', label: 'Python', aliases: ['Python'], category: 'language', adjacent: ['pandas'] },
      { id: 'pandas', label: 'pandas', aliases: ['pandas'], category: 'tool', adjacent: ['python'] },
    ];
    await seedSkills(client, defs);
    await seedSkills(client, defs);
    expect((await client.query('SELECT count(*)::int AS n FROM skills')).rows[0].n).toBe(2);
    const snap = { asOf: '2026-10-15', source: 'fixture', perUsd: { USD: '1', INR: '88.5' } };
    await seedFxRates(client, snap);
    await seedFxRates(client, snap);
    const got = await loadFxSnapshot(client);
    expect(got?.asOf).toBe('2026-10-15');
    expect(got?.source).toBe('fixture');
    expect(Number(got?.perUsd['INR'])).toBe(88.5);
    expect(await loadFxSnapshot(await freshEmpty())).toBeNull();
  });

  async function freshEmpty(): Promise<Client> {
    // a client whose fx_rates is empty: reuse the connection after truncation
    await client.query('TRUNCATE fx_rates');
    return client;
  }

  it('inserts a job with requirements, and updating replaces them', async () => {
    const p = await posting();
    const id = await insertJob(client, job({ companyId, primaryPostingId: p }));
    await linkPosting(client, p, id, 'v1:h', 1);
    await replaceRequirements(client, id, [
      { ord: 0, kind: 'must', text: '5+ years of Python', category: 'experience', skillIds: ['python'], yearsMin: 5, spanStart: 0, spanEnd: 18, section: 'requirements', extractor: 'rule', confidence: 0.9, ruleIds: ['req.kind.section_default_must'] },
    ]);
    await replaceRequirements(client, id, [
      { ord: 0, kind: 'nice', text: 'Go', category: 'skill', skillIds: [], yearsMin: null, spanStart: 1, spanEnd: 3, section: 'nice', extractor: 'rule', confidence: 0.5, ruleIds: [] },
    ]);
    const { rows } = await client.query('SELECT kind, text FROM job_requirements WHERE job_id = $1', [id]);
    expect(rows).toEqual([{ kind: 'nice', text: 'Go' }]);
    await updateJob(client, id, job({ companyId, title: 'Engineer II', primaryPostingId: p }));
    expect((await client.query('SELECT title FROM jobs WHERE id = $1', [id])).rows[0].title).toBe('Engineer II');
  });

  it('refuses a salary without a trace', async () => {
    const salary = {
      minMinor: 100, maxMinor: 200, currency: 'USD', period: 'year', annualUsdMin: 100, annualUsdMax: 200,
      annualInrMin: 8850, annualInrMax: 17700, source: 'text', kind: 'base', ctc: false, trace: null as unknown, fxDate: '2026-10-15',
    };
    await expect(insertJob(client, job({ companyId, salary: salary as never, salaryStated: true }))).rejects.toThrow();
    await insertJob(client, job({ companyId, salary: { ...salary, trace } as never, salaryStated: true }));
  });

  it('rejects an invalid level and keeps money as bigint minor units', async () => {
    await expect(insertJob(client, job({ companyId, level: 'wizard' as never }))).rejects.toThrow();
    const salary = {
      minMinor: 9_000_000_000_000, maxMinor: 9_000_000_000_001, currency: 'INR', period: 'year', annualUsdMin: null, annualUsdMax: null,
      annualInrMin: 9_000_000_000_000, annualInrMax: 9_000_000_000_001, source: 'text', kind: 'ote', ctc: true, trace, fxDate: null,
    };
    const id = await insertJob(client, job({ companyId, salary: salary as never, salaryStated: true }));
    const r = (await client.query('SELECT salary_min_minor::text AS m, salary_kind, salary_ctc FROM jobs WHERE id = $1', [id])).rows[0];
    expect(r).toEqual({ m: '9000000000000', salary_kind: 'ote', salary_ctc: true });
  });

  it('lists pending companies and postings, and a link clears them', async () => {
    const a = await posting({ seen: '2026-01-02T00:00:00Z' });
    const b = await posting({ seen: '2026-01-01T00:00:00Z' });
    await posting({ closed: true });
    expect(await listPendingCompanies(client, 1)).toEqual([{ companyId, pending: 2 }]);
    const rows = await loadPendingPostings(client, companyId, 1, 10);
    expect(rows.map((r) => r.postingId)).toEqual([b, a]); // (first_seen_at, id) order
    expect(rows[0]).toMatchObject({ ats: 'greenhouse', token: 'acme', companySlug: 'acme', closedAt: null });
    const id = await insertJob(client, job({ companyId, primaryPostingId: a }));
    await linkPosting(client, a, id, 'v1:h', 1);
    await linkPosting(client, b, id, 'v1:h', 1);
    expect(await listPendingCompanies(client, 1)).toEqual([]);
    expect(await listPendingCompanies(client, 2)).toEqual([{ companyId, pending: 2 }]); // version bump
    await client.query(`UPDATE postings SET content_hash = 'v1:changed' WHERE id = $1`, [a]);
    expect((await listPendingCompanies(client, 1))[0]?.pending).toBe(1); // content change
  });

  it('finds open cluster candidates by company and normalised title only', async () => {
    const p1 = await posting();
    const p2 = await posting();
    const j1 = await insertJob(client, job({ companyId, primaryPostingId: p1, slug: 's1', simhash: '-9223372036854775808' }));
    await insertJob(client, job({ companyId, primaryPostingId: p2, slug: 's2', titleNorm: 'other' }));
    await linkPosting(client, p1, j1, 'v1:h', 1);
    const c = await findClusterCandidates(client, companyId, 'engineer');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ jobId: j1, primaryPostingId: p1, simhash: '-9223372036854775808', tokenCount: 120 });
    await client.query(`UPDATE jobs SET closed_at = now() WHERE id = $1`, [j1]);
    expect(await findClusterCandidates(client, companyId, 'engineer')).toEqual([]);
  });

  it('derives job lifecycle from its postings and drops orphans', async () => {
    const a = await posting({ seen: '2026-01-05T00:00:00Z' });
    const b = await posting({ seen: '2026-01-03T00:00:00Z', closed: true });
    const id = await insertJob(client, job({ companyId, primaryPostingId: a }));
    await linkPosting(client, a, id, 'v1:h', 1);
    await linkPosting(client, b, id, 'v1:h', 1);
    await refreshJobLifecycle(client);
    let r = (await client.query('SELECT first_seen_at, closed_at FROM jobs WHERE id = $1', [id])).rows[0];
    expect(r.first_seen_at.toISOString()).toBe('2026-01-03T00:00:00.000Z');
    expect(r.closed_at).toBeNull();
    await client.query(`UPDATE postings SET closed_at = '2026-03-01' WHERE id = $1`, [a]);
    await refreshJobLifecycle(client);
    r = (await client.query('SELECT closed_at FROM jobs WHERE id = $1', [id])).rows[0];
    expect(r.closed_at.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    await client.query(`UPDATE postings SET job_id = NULL`);
    const out = await refreshJobLifecycle(client);
    expect(out.orphansDeleted).toBe(1);
  });

  it('unions countries and locations of the open postings into the job', async () => {
    const a = await posting({ seen: '2026-01-01T00:00:00Z' });
    const b = await posting({ seen: '2026-01-02T00:00:00Z' });
    const c = await posting({ seen: '2026-01-03T00:00:00Z', closed: true });
    const id = await insertJob(client, job({ companyId, primaryPostingId: a, countries: ['US'] }));
    await linkPosting(client, a, id, 'v1:h', 1, { countries: ['US'], locations: ['Austin, TX'] });
    await linkPosting(client, b, id, 'v1:h', 1, { countries: ['GB', 'US'], locations: ['London, UK', 'Austin, TX'] });
    await linkPosting(client, c, id, 'v1:h', 1, { countries: ['IN'], locations: ['Bengaluru'] });
    await refreshJobLifecycle(client);
    const r = (await client.query(`SELECT countries, locations FROM jobs WHERE id = $1`, [id])).rows[0];
    expect(r.countries).toEqual(['GB', 'US']);
    expect(r.locations.all).toEqual(['Austin, TX', 'London, UK']);
    // closing the later one changes nothing; closing b drops GB
    await client.query(`UPDATE postings SET closed_at = now() WHERE id = $1`, [b]);
    await refreshJobLifecycle(client);
    expect((await client.query(`SELECT countries FROM jobs WHERE id = $1`, [id])).rows[0].countries).toEqual(['US']);
  });

  it('keeps the job geo when its postings carry none (enriched before posting geo existed)', async () => {
    const a = await posting();
    const id = await insertJob(client, job({ companyId, primaryPostingId: a, countries: ['DE'] }));
    await linkPosting(client, a, id, 'v1:h', 1);
    await refreshJobLifecycle(client);
    expect((await client.query(`SELECT countries FROM jobs WHERE id = $1`, [id])).rows[0].countries).toEqual(['DE']);
  });

  it('grants the app role read access to public job data only', async () => {
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.role_table_grants WHERE grantee = 'hirelane_app' AND privilege_type = 'SELECT' AND table_name IN ('jobs','job_requirements','skills')`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(['job_requirements', 'jobs', 'skills']);
  });
});
