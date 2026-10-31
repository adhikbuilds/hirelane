import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

/** A company, a board, a posting and a job on it. Synthetic. `ats` picks the platform; the apply URL uses the reserved .invalid TLD. */
export async function mkJob(
  c: Pick<Client, 'query'>,
  o: { ats?: 'greenhouse' | 'lever' | 'ashby'; closed?: boolean; applyUrl?: string | null; org?: string } = {},
): Promise<{ jobId: string; companyId: string; postingId: string; org: string }> {
  const tag = randomUUID().slice(0, 8);
  const org = o.org ?? `acme-${tag}`;
  const ats = o.ats ?? 'greenhouse';
  const companyId = randomUUID();
  const boardId = randomUUID();
  const postingId = randomUUID();
  const jobId = randomUUID();
  await c.query('INSERT INTO companies (id, slug, name, domain) VALUES ($1, $2, $3, $4)', [companyId, org, `Acme ${tag}`, `${org}.example.test`]);
  await c.query('INSERT INTO company_boards (id, company_id, ats, token) VALUES ($1, $2, $3, $4)', [boardId, companyId, ats, org]);
  const url = o.applyUrl === undefined ? `https://${ats}.fixture.invalid/${org}/job-${tag}` : o.applyUrl;
  await c.query(
    `INSERT INTO postings (id, board_id, external_id, key, url, apply_url, title, raw, content_hash, first_seen_at, last_seen_at, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'Graduate Engineer', '{}'::jsonb, $7, now(), now(), 'fixture')`,
    [postingId, boardId, `ext-${tag}`, `key-${tag}`, `https://${ats}.fixture.invalid/${org}/public-${tag}`, url, `h-${tag}`],
  );
  await c.query(
    `INSERT INTO jobs (id, slug, company_id, title, title_norm, doc_hash, first_seen_at, last_seen_at, closed_at, enrich_version, primary_posting_id, source)
     VALUES ($1, $2, $3, 'Graduate Engineer', 'graduate engineer', $4, now(), now(), $5, 1, $6, 'fixture')`,
    [jobId, `job-${tag}`, companyId, `d-${tag}`, o.closed ? new Date() : null, postingId],
  );
  return { jobId, companyId, postingId, org };
}
