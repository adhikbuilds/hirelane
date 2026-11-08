/**
 * Migration 0018 against a real Postgres. Uses its own database (hirelane_ingest_v2_test) so it never collides with other
 * suites, and applies only 0001..0016 + 0018 so another change's in-progress 0017 cannot affect it.
 * Phase 1 builds the pre-0018 schema and seeds data; phase 2 applies 0018, so the backfill is exercised on real rows.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sourceForPosting } from '../src/source';

process.env['TEST_DATABASE_URL'] ??= 'postgres://hirelane:hirelane@localhost:5433/hirelane_ingest_v2_test';

const MIG = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
interface Client {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
}
let client: Client;
const ids: Record<string, string> = {};

function stage(pred: (f: string) => boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql') && pred(x))) copyFileSync(join(MIG, f), join(dir, f));
  return dir;
}
const upTo16 = (f: string) => /^00(0\d|1[0-6])/.test(f);
const upTo16And18 = (f: string) => upTo16(f) || f.startsWith('0018_');

async function company(slug: string, name: string): Promise<string> {
  const { rows } = await client.query('INSERT INTO companies (slug, name) VALUES ($1, $2) RETURNING id', [slug, name]);
  return rows[0].id;
}
async function board(companyId: string, ats: string, token: string): Promise<string> {
  const { rows } = await client.query('INSERT INTO company_boards (company_id, ats, token) VALUES ($1, $2, $3) RETURNING id', [companyId, ats, token]);
  return rows[0].id;
}
async function posting(boardId: string, ext: string, url: string): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO postings (board_id, external_id, key, url, title, raw, content_hash, first_seen_at, last_seen_at, source)
     VALUES ($1, $2, $3, $4, 'T', '{}', 'h', now(), now(), 'fixture') RETURNING id`,
    [boardId, ext, `k:${boardId}:${ext}`, url],
  );
  return rows[0].id;
}
async function job(companyId: string, slug: string, primary: string | null, extra: Record<string, string> = {}): Promise<string> {
  const cols = ['slug', 'company_id', 'title', 'title_norm', 'doc_hash', 'first_seen_at', 'last_seen_at', 'enrich_version', 'source', 'primary_posting_id', ...Object.keys(extra)];
  const vals = [slug, companyId, 'T', 't', 'd', new Date(), new Date(), 1, 'fixture', primary, ...Object.values(extra)];
  const { rows } = await client.query(`INSERT INTO jobs (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, vals);
  return rows[0].id;
}
const src = async (id: string) => (await client.query('SELECT source_kind, source_label, source_url FROM jobs WHERE id = $1', [id])).rows[0];

beforeAll(async () => {
  const { freshTestClient } = await import('../../db/test/helpers');
  const { applyMigrations } = await import('../../db/src/migrator');
  client = (await freshTestClient()) as unknown as Client;
  await applyMigrations(client as never, stage(upTo16));

  const gh = await company('cred', 'CRED');
  const lv = await company('paytm', 'Paytm');
  const ab = await company('atlan', 'Atlan');
  const pGh = await posting(await board(gh, 'greenhouse', 'cred'), '1', 'https://boards.greenhouse.io/cred/jobs/1');
  const pLv = await posting(await board(lv, 'lever', 'paytm'), '1', 'https://jobs.lever.co/paytm/1');
  const pAb = await posting(await board(ab, 'ashby', 'atlan'), '1', 'https://jobs.ashbyhq.com/atlan/1');
  const pHttp = await posting(await board(await company('httpco', 'HttpCo'), 'lever', 'httpco'), '1', 'http://insecure.example.com/1');
  Object.assign(ids, { gh, lv, ab, pGh, pLv, pAb });
  ids['jGh'] = await job(gh, 'j-gh', pGh);
  ids['jLv'] = await job(lv, 'j-lv', pLv);
  ids['jAb'] = await job(ab, 'j-ab', null); // primary lost; falls back to the posting that points at the job
  await client.query('UPDATE postings SET job_id = $1 WHERE id = $2', [ids['jAb'], pAb]);
  ids['jOrphan'] = await job(gh, 'j-orphan', null);
  ids['jHttp'] = await job(gh, 'j-http', pHttp);

  await applyMigrations(client as never, stage(upTo16And18));
});
afterAll(async () => {
  await client?.end();
});

describe('0018 backfill', () => {
  it('derives kind, label and the original url for existing jobs', async () => {
    expect(await src(ids['jGh']!)).toEqual({ source_kind: 'greenhouse', source_label: 'Greenhouse · CRED', source_url: 'https://boards.greenhouse.io/cred/jobs/1' });
    expect(await src(ids['jLv']!)).toEqual({ source_kind: 'lever', source_label: 'Lever · Paytm', source_url: 'https://jobs.lever.co/paytm/1' });
  });
  it('falls back to the posting that points at the job when the primary is gone', async () => {
    expect(await src(ids['jAb']!)).toEqual({ source_kind: 'ashby', source_label: 'Ashby · Atlan', source_url: 'https://jobs.ashbyhq.com/atlan/1' });
  });
  it('leaves NULLs (all three) when nothing resolvable exists: no orphan gets a made-up source', async () => {
    expect(await src(ids['jOrphan']!)).toEqual({ source_kind: null, source_label: null, source_url: null });
    expect(await src(ids['jHttp']!)).toEqual({ source_kind: null, source_label: null, source_url: null });
  });
});

describe('0018 trigger and constraints', () => {
  it('company_boards accepts jsonld and zoho_rss but not other kinds', async () => {
    const c = await company('trellis', 'Trellis Cloud');
    const bj = await board(c, 'jsonld', 'careers.trelliscloud.in');
    await board(c, 'zoho_rss', 'in-60012345678');
    await expect(board(c, 'workday', 'x')).rejects.toThrow(/company_boards_ats_check/);
    ids['c'] = c;
    ids['bj'] = bj;
  });

  it('a new job inherits the source from its primary posting (jsonld label is the careers host)', async () => {
    const p = await posting(ids['bj']!, 'TC-1', 'https://careers.trelliscloud.in/jobs/1');
    const j = await job(ids['c']!, 'j-new', p);
    expect(await src(j)).toEqual({ source_kind: 'jsonld', source_label: 'careers.trelliscloud.in', source_url: 'https://careers.trelliscloud.in/jobs/1' });
    ids['jNew'] = j;
    ids['pNew'] = p;
  });

  it('matches the TypeScript twin sourceForPosting for every ATS kind', async () => {
    const ts = sourceForPosting({ ats: 'lever', boardToken: 'paytm', companyName: 'Paytm', url: 'https://jobs.lever.co/paytm/1' });
    const row = await src(ids['jLv']!);
    expect([row.source_kind, row.source_label, row.source_url]).toEqual([ts.sourceKind, ts.sourceLabel, ts.sourceUrl]);
    const zb = await board(await company('zco', 'ZCo'), 'zoho_rss', 'in-60099999999');
    const zp = await posting(zb, 'Z1', 'https://zco.zohorecruit.in/recruit/ViewJob.na?digest=1');
    const zj = await job(ids['c']!, 'j-z', zp);
    const zts = sourceForPosting({ ats: 'zoho_rss', boardToken: 'in-60099999999', companyName: 'ZCo', url: 'https://zco.zohorecruit.in/recruit/ViewJob.na?digest=1' });
    const zr = await src(zj);
    expect([zr.source_kind, zr.source_label, zr.source_url]).toEqual([zts.sourceKind, zts.sourceLabel, zts.sourceUrl]);
  });

  it('re-derives when the primary posting moves, but never overwrites user_shared or campus_drive', async () => {
    const other = await posting(await board(await company('o', 'Other'), 'ashby', 'other'), '9', 'https://jobs.ashbyhq.com/other/9');
    await client.query('UPDATE jobs SET primary_posting_id = $1 WHERE id = $2', [other, ids['jNew']]);
    expect((await src(ids['jNew']!)).source_kind).toBe('ashby');

    const shared = await job(ids['c']!, 'j-shared', null, { source_kind: 'user_shared', source_label: 'Shared from Reddit', source_url: 'https://www.reddit.com/r/x/comments/1' });
    await client.query('UPDATE jobs SET primary_posting_id = $1 WHERE id = $2', [other, shared]);
    expect(await src(shared)).toEqual({ source_kind: 'user_shared', source_label: 'Shared from Reddit', source_url: 'https://www.reddit.com/r/x/comments/1' });
  });

  it('enforces all-or-none, https, the kind set and the user_shared label set', async () => {
    const bad = (extra: Record<string, string>) => job(ids['c']!, `b-${Math.random()}`, null, extra);
    await expect(bad({ source_kind: 'greenhouse' })).rejects.toThrow(/jobs_source_all_or_none/);
    await expect(bad({ source_kind: 'reddit', source_label: 'x', source_url: 'https://a.com/x' })).rejects.toThrow(/jobs_source_kind_check/);
    await expect(bad({ source_kind: 'user_shared', source_label: 'Shared from Reddit', source_url: 'http://a.com/x' })).rejects.toThrow(/jobs_source_url_https/);
    await expect(bad({ source_kind: 'user_shared', source_label: 'Shared from Facebook', source_url: 'https://a.com/x' })).rejects.toThrow(/jobs_user_shared_label/);
    for (const label of ['Shared from Reddit', 'Shared from WhatsApp', 'Shared from LinkedIn', 'Shared from Telegram', 'Shared link']) {
      await bad({ source_kind: 'user_shared', source_label: label, source_url: 'https://a.com/x' });
    }
  });

  it('the app role can read the new columns', async () => {
    const { rows } = await client.query(
      "SELECT has_column_privilege('hirelane_app', 'jobs', c, 'SELECT') AS ok FROM unnest(ARRAY['source_kind','source_label','source_url']) c",
    );
    expect(rows.every((r: { ok: boolean }) => r.ok)).toBe(true);
  });
});
