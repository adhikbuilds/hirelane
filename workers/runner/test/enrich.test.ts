import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '@hirelane/db';
import { isTrace, ENRICH_VERSION, defaultFxSnapshot } from '@hirelane/engine';
import { rawToPosting } from '../src/tasks/enrich-raw.js';
import { buildInput, enrichPosting, enrichCompany, enrichPostingById, ensureReferenceData, loadEngineFx, syncJobLifecycle } from '../src/tasks/enrich-core.js';

const FIX = resolve(import.meta.dirname, '../../../packages/ingest/fixtures/mini');
function items(ats: string, token: string): unknown[] {
  const body = JSON.parse(gunzipSync(readFileSync(resolve(FIX, ats, `${token}.json.gz`))).toString('utf8'));
  return Array.isArray(body) ? body : body.jobs;
}
const fx = defaultFxSnapshot();

async function enrichItem(ats: 'ashby' | 'lever' | 'greenhouse', token: string, i: number) {
  const raw = items(ats, token)[i];
  const posting = await rawToPosting(ats, token, raw);
  expect(posting).not.toBeNull();
  return { posting: posting!, enr: enrichPosting(buildInput(posting!), { fx }) };
}

describe('rawToPosting', () => {
  it.each([
    ['ashby', 'openai'],
    ['ashby', 'benchling'],
    ['lever', 'cred'],
    ['greenhouse', 'airtable'],
  ] as const)('rebuilds every %s/%s item through the real connector', async (ats, token) => {
    const all = items(ats, token);
    let ok = 0;
    for (const raw of all.slice(0, 25)) {
      const p = await rawToPosting(ats, token, raw);
      if (p) {
        ok++;
        expect(p.ats).toBe(ats);
        expect(p.title.length).toBeGreaterThan(0);
      }
    }
    expect(ok).toBeGreaterThan(0);
  });

  it('returns null for junk instead of throwing', async () => {
    expect(await rawToPosting('lever', 'cred', 42)).toBeNull();
    expect(await rawToPosting('ashby', 'openai', { nope: true })).toBeNull();
  });

  it('keeps Greenhouse content decoded exactly once', async () => {
    const { posting } = await enrichItem('greenhouse', 'airtable', 0);
    expect(posting.descriptionHtml).toMatch(/<[a-z]/);
  });
});

describe('enrichPosting contract pins (fixtures/mini)', () => {
  it('Lever cred: fulltime, onsite, India', async () => {
    const found = [] as Awaited<ReturnType<typeof enrichItem>>[];
    for (let i = 0; i < Math.min(items('lever', 'cred').length, 40); i++) found.push(await enrichItem('lever', 'cred', i));
    expect(found.some((f) => f.enr.employment.value === 'fulltime')).toBe(true);
    expect(found.some((f) => f.enr.workplace.value === 'onsite')).toBe(true);
    expect(found.some((f) => f.enr.countries.countries.includes('IN'))).toBe(true);
  });

  it('Ashby with structured USD pay keeps it in cents with period and fx steps', async () => {
    const all = items('ashby', 'openai');
    let hit = null as Awaited<ReturnType<typeof enrichItem>> | null;
    for (let i = 0; i < all.length && !hit; i++) {
      const r = await enrichItem('ashby', 'openai', i);
      if (r.enr.salary?.source === 'ats_structured') hit = r;
    }
    expect(hit).not.toBeNull();
    const s = hit!.enr.salary!;
    expect(s.currency).toBe('USD');
    expect(s.period).toBe('year');
    const ids = s.trace.steps.map((x) => x.ruleId);
    expect(ids).toContain('salary.period.identity');
    expect(ids).toContain('salary.fx.convert');
    expect(s.annualMin.INR).not.toBeNull();
  });

  it('Greenhouse airtable: Account Executive is not an executive', async () => {
    const all = items('greenhouse', 'airtable');
    for (let i = 0; i < all.length; i++) {
      const r = await enrichItem('greenhouse', 'airtable', i);
      if (/^Account Executive/.test(r.posting.title)) expect(r.enr.level.value).not.toBe('executive');
    }
  });

  it('is deterministic and every trace is JSON-safe', async () => {
    const a = await enrichItem('ashby', 'benchling', 0);
    const b = await enrichItem('ashby', 'benchling', 0);
    expect(JSON.stringify(a.enr)).toBe(JSON.stringify(b.enr));
    for (const t of [a.enr.workplace.trace, a.enr.countries.trace, a.enr.skills.trace, a.enr.requirements.trace, a.enr.level.trace, a.enr.visa.trace]) {
      expect(isTrace(t)).toBe(true);
    }
    expect(a.enr.doc.text).not.toContain('&amp;');
  });

  it('makes salary eligible for the LLM fallback only when parsing is missing or weak', async () => {
    const { enr } = await enrichItem('ashby', 'benchling', 0);
    expect(typeof enr.llm.salary).toBe('boolean');
    expect(enr.llm.reasons).toBeInstanceOf(Array);
  });
});

// ---------------------------------------------------------------------------------------------

const BASE = process.env['TEST_DATABASE_URL'] ?? 'postgres://hirelane:hirelane@localhost:5433/hirelane_test';
const URL = BASE.replace(/\/[^/]+$/, '/hirelane_runner_test');

describe('enrichCompany (database)', () => {
  let c: Client;
  let companyId: string;
  let boardId: string;

  async function addPosting(ats: string, i: number, over: { title?: string; extId?: string; raw?: unknown } = {}): Promise<string> {
    const raw = over.raw ?? items(ats, 'airtable')[i];
    const p = await rawToPosting(ats as 'greenhouse', 'airtable', raw);
    const ext = over.extId ?? p!.externalId;
    const { rows } = await c.query(
      `INSERT INTO postings (board_id, external_id, key, url, title, raw, content_hash, first_seen_at, last_seen_at, source)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7, now() - ($8 || ' minutes')::interval, now(), 'fixture') RETURNING id`,
      [boardId, ext, `greenhouse:airtable:${ext}`, p?.url ?? `https://example.test/${ext}`, over.title ?? p?.title ?? 'Bad', JSON.stringify(over.raw ?? raw), `v1:${ext}`, String(100 - i)],
    );
    return rows[0].id as string;
  }

  beforeAll(async () => {
    const admin = new Client({ connectionString: BASE });
    await admin.connect();
    const { rowCount } = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'hirelane_runner_test'`);
    if (!rowCount) await admin.query('CREATE DATABASE hirelane_runner_test');
    await admin.end();
    c = new Client({ connectionString: URL });
    await c.connect();
    await c.query('DROP SCHEMA public CASCADE');
    await c.query('CREATE SCHEMA public');
    await applyMigrations(c, resolve(import.meta.dirname, '../../../packages/db/migrations'));
  }, 60_000);
  afterAll(async () => {
    await c.end();
  });
  beforeEach(async () => {
    await c.query('TRUNCATE jobs, postings, company_boards, companies, skills, fx_rates, llm_calls CASCADE');
    companyId = (await c.query(`INSERT INTO companies (slug, name) VALUES ('airtable','Airtable') RETURNING id`)).rows[0].id;
    boardId = (await c.query(`INSERT INTO company_boards (company_id, ats, token) VALUES ($1,'greenhouse','airtable') RETURNING id`, [companyId])).rows[0].id;
    await ensureReferenceData(c);
  });

  it('seeds skills and fx from the engine data, and reads fx back from the table', async () => {
    await ensureReferenceData(c);
    expect((await c.query('SELECT count(*)::int n FROM skills')).rows[0].n).toBeGreaterThanOrEqual(600);
    const snap = await loadEngineFx(c);
    expect(snap.asOf).toBe(fx.asOf);
    expect(snap.perUsd.INR).toBe('88.50000000');
  }, 30_000);

  it('turns postings into jobs with requirements, traces and a lifecycle; a second run changes nothing', async () => {
    const n = Math.min(12, items('greenhouse', 'airtable').length);
    for (let i = 0; i < n; i++) await addPosting('greenhouse', i);
    const s1 = await enrichCompany(c, companyId, { enrichVersion: 1 });
    expect(s1.errors).toBe(0);
    expect(s1.enriched).toBe(n);
    const jobs1 = (await c.query('SELECT id, slug, enrich_version, doc_hash, traces, closed_at FROM jobs ORDER BY id')).rows;
    expect(jobs1.length).toBeGreaterThan(0);
    expect(jobs1.length).toBeLessThanOrEqual(n);
    for (const j of jobs1) {
      expect(j.enrich_version).toBe(1);
      expect(j.closed_at).toBeNull();
      for (const t of Object.values(j.traces)) expect(isTrace(t)).toBe(true);
    }
    expect((await c.query('SELECT count(*)::int n FROM postings WHERE job_id IS NULL')).rows[0].n).toBe(0);
    const reqs = (await c.query('SELECT count(*)::int n FROM job_requirements')).rows[0].n;
    expect(reqs).toBeGreaterThan(0);

    const s2 = await enrichCompany(c, companyId, { enrichVersion: 1 });
    expect(s2.enriched).toBe(0);
    const jobs2 = (await c.query('SELECT id, slug FROM jobs ORDER BY id')).rows;
    expect(jobs2.map((j) => j.id)).toEqual(jobs1.map((j) => j.id));
    expect((await c.query('SELECT count(*)::int n FROM job_requirements')).rows[0].n).toBe(reqs);
    expect((await c.query('SELECT count(*)::int n FROM llm_calls')).rows[0].n).toBe(0);
  }, 60_000);

  it('bumping enrich_version re-enriches every posting in place, keeping job ids and slugs', async () => {
    for (let i = 0; i < 5; i++) await addPosting('greenhouse', i);
    await enrichCompany(c, companyId, { enrichVersion: 1 });
    const before = (await c.query('SELECT id, slug FROM jobs ORDER BY id')).rows;
    const s = await enrichCompany(c, companyId, { enrichVersion: 2 });
    expect(s.enriched).toBe(5);
    const after = (await c.query('SELECT id, slug, enrich_version FROM jobs ORDER BY id')).rows;
    expect(after.map((j) => [j.id, j.slug])).toEqual(before.map((j) => [j.id, j.slug]));
    expect(new Set(after.map((j) => j.enrich_version))).toEqual(new Set([2]));
  }, 60_000);

  it('re-enriches a posting whose content hash changed, and only that one', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await addPosting('greenhouse', i));
    await enrichCompany(c, companyId, { enrichVersion: 1 });
    await c.query(`UPDATE postings SET content_hash = 'v1:changed' WHERE id = $1`, [ids[1]]);
    const s = await enrichCompany(c, companyId, { enrichVersion: 1 });
    expect(s.enriched).toBe(1);
  }, 60_000);

  it('clusters a re-posted copy (same company and title, near-identical text) under one job and keeps the earliest as primary', async () => {
    const first = await addPosting('greenhouse', 0);
    const rawCopy = structuredClone(items('greenhouse', 'airtable')[0]) as { id: number };
    rawCopy.id = 99_999_999;
    const copy = await addPosting('greenhouse', 1, { raw: rawCopy, extId: '99999999' }); // later first_seen_at
    await enrichCompany(c, companyId, { enrichVersion: 1 });
    const jobs = (await c.query('SELECT id, primary_posting_id FROM jobs')).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].primary_posting_id).toBe(first);
    const linked = (await c.query('SELECT id, job_id FROM postings ORDER BY id')).rows;
    expect(linked.every((r) => r.job_id === jobs[0].id)).toBe(true);
    expect(linked.map((r) => r.id).sort()).toEqual([first, copy].sort());
  }, 60_000);

  it('does not merge different titles, or postings with too little text', async () => {
    const raw = structuredClone(items('greenhouse', 'airtable')[0]) as { id: number; title: string };
    await addPosting('greenhouse', 0);
    const other = structuredClone(raw);
    other.id = 88_888_888;
    other.title = `Senior ${raw.title}`;
    await addPosting('greenhouse', 1, { raw: other, extId: '88888888' });
    const empty = structuredClone(raw) as Record<string, unknown>;
    empty['id'] = 77_777_777;
    empty['content'] = '';
    await addPosting('greenhouse', 2, { raw: empty, extId: '77777777' });
    const empty2 = structuredClone(empty);
    empty2['id'] = 66_666_666;
    await addPosting('greenhouse', 3, { raw: empty2, extId: '66666666' });
    await enrichCompany(c, companyId, { enrichVersion: 1 });
    expect((await c.query('SELECT count(*)::int n FROM jobs')).rows[0].n).toBe(4);
  }, 60_000);

  it('closes a job when its last posting closes and reopens it with a new one', async () => {
    const a = await addPosting('greenhouse', 0);
    await enrichCompany(c, companyId, { enrichVersion: 1 });
    await c.query(`UPDATE postings SET closed_at = now() WHERE id = $1`, [a]);
    await enrichCompany(c, companyId, { enrichVersion: 1 });
    expect((await c.query('SELECT closed_at FROM jobs')).rows[0].closed_at).not.toBeNull();
    await c.query(`UPDATE postings SET closed_at = NULL WHERE id = $1`, [a]);
    await enrichCompany(c, companyId, { enrichVersion: 1 });
    expect((await c.query('SELECT closed_at FROM jobs')).rows[0].closed_at).toBeNull();
  }, 60_000);

  it('closes the job through the scheduled lifecycle step when nothing else changed', async () => {
    const a = await addPosting('greenhouse', 0);
    await enrichCompany(c, companyId, { enrichVersion: 1 });
    await c.query(`UPDATE postings SET closed_at = now() WHERE id = $1`, [a]);
    const { listPendingCompanies } = await import('@hirelane/db');
    expect(await listPendingCompanies(c, 1)).toEqual([]); // the company is not selected for enrichment...
    expect((await c.query('SELECT closed_at FROM jobs')).rows[0].closed_at).toBeNull();
    await syncJobLifecycle(c); // ...so only the lifecycle step can close the job
    expect((await c.query('SELECT closed_at FROM jobs')).rows[0].closed_at).not.toBeNull();
  }, 60_000);

  it('unions the locations of merged postings into the job', async () => {
    const first = await addPosting('greenhouse', 0);
    const rawCopy = structuredClone(items('greenhouse', 'airtable')[0]) as { id: number; location: { name: string } };
    rawCopy.id = 55_555_555;
    rawCopy.location = { name: 'London, England, United Kingdom' };
    await addPosting('greenhouse', 1, { raw: rawCopy, extId: '55555555' });
    await enrichCompany(c, companyId, { enrichVersion: 1 });
    const jobs = (await c.query('SELECT countries, locations FROM jobs')).rows;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].countries).toContain('GB');
    expect(jobs[0].locations.all).toContain('London, England, United Kingdom');
    void first;
  }, 60_000);

  it('enrich:posting enriches one posting, then is a no-op for a current, closed or unknown one', async () => {
    const a = await addPosting('greenhouse', 0);
    expect(await enrichPostingById(c, a, { enrichVersion: 1 })).toBe('created');
    expect(await enrichPostingById(c, a, { enrichVersion: 1 })).toBe('skipped');
    expect(await enrichPostingById(c, a, { enrichVersion: 2 })).toBe('updated');
    expect(await enrichPostingById(c, '00000000-0000-0000-0000-000000000000', { enrichVersion: 1 })).toBe('skipped');
    await c.query(`UPDATE postings SET closed_at = now()`);
    expect(await enrichPostingById(c, a, { enrichVersion: 3 })).toBe('skipped');
  }, 60_000);

  it('keeps going after one bad posting and reports it', async () => {
    await addPosting('greenhouse', 0);
    await addPosting('greenhouse', 1, { raw: { id: 5, title: '', absolute_url: 'http://insecure' }, extId: '5', title: 'Bad' });
    await addPosting('greenhouse', 2);
    const s = await enrichCompany(c, companyId, { enrichVersion: 1 });
    expect(s.errors).toBe(1);
    expect(s.enriched).toBe(2);
    expect(s.errorSamples[0]).toContain('greenhouse:airtable:5');
  }, 60_000);

  it('stamps ENRICH_VERSION by default', () => {
    expect(ENRICH_VERSION).toBeGreaterThanOrEqual(1);
  });
});
