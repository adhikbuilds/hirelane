/**
 * SQL for the enrichment worker. Plain values in, plain values out: this package never imports the engine
 * (package boundary), so composition lives in workers/runner.
 */
import type { Client, PoolClient } from 'pg';

type Queryable = Client | PoolClient;

export interface SkillRow {
  id: string;
  label: string;
  aliases: readonly string[];
  category: string;
  adjacent: readonly string[];
}

export interface FxSnapshotRow {
  asOf: string;
  source: string;
  perUsd: Record<string, string>;
}

export interface JobSalaryWrite {
  /** Stated period, native currency, minor units. */
  minMinor: number | null;
  maxMinor: number | null;
  currency: string;
  period: string;
  annualUsdMin: number | null;
  annualUsdMax: number | null;
  annualInrMin: number | null;
  annualInrMax: number | null;
  source: 'ats_structured' | 'text' | 'llm';
  kind: 'base' | 'ote';
  ctc: boolean;
  trace: unknown;
  fxDate: string | null;
}

export interface JobWrite {
  companyId: string;
  slug: string;
  title: string;
  titleNorm: string;
  roleFamily: string | null;
  level: string | null;
  workplace: string | null;
  employment: string | null;
  remote: boolean;
  remoteScope: 'none' | 'countries' | 'region' | 'worldwide';
  countries: string[];
  locations: unknown;
  visa: 'yes' | 'no' | 'unknown';
  descriptionMd: string | null;
  descriptionText: string | null;
  docHash: string;
  salary: JobSalaryWrite | null;
  salaryStated: boolean;
  skills: string[];
  /** Signed int64 decimal (Simhash.pg), or null. */
  simhash: string | null;
  tokenCount: number;
  traces: unknown;
  llmEligibility: unknown;
  postedAt: Date | string | null;
  enrichVersion: number;
  primaryPostingId: string | null;
  source: 'live' | 'fixture';
}

export interface RequirementWrite {
  ord: number;
  kind: 'must' | 'nice';
  text: string;
  category: string;
  skillIds: string[];
  yearsMin: number | null;
  spanStart: number;
  spanEnd: number;
  section: string | null;
  extractor: 'rule' | 'llm';
  confidence: number;
  ruleIds: string[];
}

export interface PendingPosting {
  postingId: string;
  companyId: string;
  companySlug: string;
  ats: string;
  token: string;
  key: string;
  url: string;
  title: string;
  raw: unknown;
  contentHash: string;
  postedAt: Date | null;
  /** ISO string, usable by the engine's pickPrimary. */
  firstSeenAt: string;
  closedAt: Date | null;
  source: 'live' | 'fixture';
  jobId: string | null;
}

/** What one posting says about where the role is. A job spanning several postings shows the union. */
export interface PostingGeo {
  countries: string[];
  locations: string[];
}

export interface ClusterCandidate {
  jobId: string;
  primaryPostingId: string;
  simhash: string;
  tokenCount: number;
  primaryFirstSeenAt: string;
}

const PENDING = `(p.enriched_version IS DISTINCT FROM $2 OR p.enriched_content_hash IS DISTINCT FROM p.content_hash)`;

export async function seedSkills(client: Queryable, rows: readonly SkillRow[]): Promise<number> {
  const { rowCount } = await client.query(
    `INSERT INTO skills (id, label, aliases, category, adjacent)
     SELECT x->>'id', x->>'label', ARRAY(SELECT jsonb_array_elements_text(x->'aliases')),
            x->>'category', ARRAY(SELECT jsonb_array_elements_text(x->'adjacent'))
       FROM jsonb_array_elements($1::jsonb) x
     ON CONFLICT (id) DO UPDATE
        SET label = EXCLUDED.label, aliases = EXCLUDED.aliases, category = EXCLUDED.category,
            adjacent = EXCLUDED.adjacent, updated_at = now()
      WHERE (skills.label, skills.aliases, skills.category, skills.adjacent)
            IS DISTINCT FROM (EXCLUDED.label, EXCLUDED.aliases, EXCLUDED.category, EXCLUDED.adjacent)`,
    [JSON.stringify(rows)],
  );
  // job_search_text embeds skill labels, so a changed label must reach the jobs that carry the skill.
  if ((rowCount ?? 0) > 0) await rebuildSearchText(client);
  return rowCount ?? 0;
}

/** Recomputes jobs.search_text (company rename, skills reseed). Scope to one company, or pass none for all jobs. */
export async function rebuildSearchText(client: Queryable, companyId?: string): Promise<number> {
  const { rowCount } = await client.query(
    `UPDATE jobs j SET search_text = job_search_text(j.title, j.company_id, j.skills)
      WHERE ${companyId ? 'j.company_id = $1 AND ' : ''}j.search_text IS DISTINCT FROM job_search_text(j.title, j.company_id, j.skills)`,
    companyId ? [companyId] : [],
  );
  return rowCount ?? 0;
}

/**
 * Rebuilds job_facets. CONCURRENTLY never blocks readers but needs a populated view and cannot share a transaction
 * with other statements that matter; use the plain form for seeding and tests.
 */
export async function refreshJobFacets(client: Queryable, opts: { concurrently?: boolean } = {}): Promise<void> {
  if (opts.concurrently) {
    await client.query("SET lock_timeout = '5s'");
    await client.query("SET statement_timeout = '60s'");
    try {
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY job_facets');
    } finally {
      await client.query('RESET lock_timeout');
      await client.query('RESET statement_timeout');
    }
  } else {
    await client.query('REFRESH MATERIALIZED VIEW job_facets');
  }
}

export async function seedFxRates(client: Queryable, snap: FxSnapshotRow): Promise<number> {
  const entries = Object.entries(snap.perUsd);
  const { rowCount } = await client.query(
    `INSERT INTO fx_rates (as_of, currency, per_usd, source)
     SELECT $1::date, c, r::numeric, $4 FROM unnest($2::text[], $3::text[]) AS t(c, r)
     ON CONFLICT (as_of, currency) DO UPDATE SET per_usd = EXCLUDED.per_usd, source = EXCLUDED.source, updated_at = now()
      WHERE (fx_rates.per_usd, fx_rates.source) IS DISTINCT FROM (EXCLUDED.per_usd, EXCLUDED.source)`,
    [snap.asOf, entries.map(([c]) => c), entries.map(([, r]) => r), snap.source],
  );
  return rowCount ?? 0;
}

/** The latest snapshot, or null when fx_rates is empty. Rates come back as numeric text ('88.50000000'). */
export async function loadFxSnapshot(client: Queryable): Promise<FxSnapshotRow | null> {
  const { rows } = await client.query<{ as_of: string; currency: string; per_usd: string; source: string }>(
    `SELECT as_of::text AS as_of, currency, per_usd::text AS per_usd, source
       FROM fx_rates WHERE as_of = (SELECT max(as_of) FROM fx_rates) ORDER BY currency`,
  );
  if (rows.length === 0) return null;
  return {
    asOf: rows[0]!.as_of,
    source: rows[0]!.source,
    perUsd: Object.fromEntries(rows.map((r) => [r.currency.trim(), r.per_usd])),
  };
}

/** Serialises clustering per company for the length of the transaction. */
export async function lockCompany(client: Queryable, companyId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 4)::bigint)', [companyId]);
}

export async function listPendingCompanies(client: Queryable, enrichVersion: number): Promise<{ companyId: string; pending: number }[]> {
  const { rows } = await client.query<{ company_id: string; pending: number }>(
    `SELECT b.company_id, count(*)::int AS pending
       FROM postings p JOIN company_boards b ON b.id = p.board_id
      WHERE p.closed_at IS NULL AND (p.enriched_version IS DISTINCT FROM $1 OR p.enriched_content_hash IS DISTINCT FROM p.content_hash)
      GROUP BY b.company_id ORDER BY pending DESC, b.company_id`,
    [enrichVersion],
  );
  return rows.map((r) => ({ companyId: r.company_id, pending: r.pending }));
}

const POSTING_SELECT = `SELECT p.id, b.company_id, c.slug AS company_slug, b.ats, b.token, p.key, p.url, p.title, p.raw, p.content_hash,
            p.posted_at, p.first_seen_at, p.closed_at, p.source, p.job_id, p.enriched_version, p.enriched_content_hash
       FROM postings p
       JOIN company_boards b ON b.id = p.board_id
       JOIN companies c ON c.id = b.company_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPending(r: any): PendingPosting {
  return {
    postingId: r.id,
    companyId: r.company_id,
    companySlug: r.company_slug,
    ats: r.ats,
    token: r.token,
    key: r.key,
    url: r.url,
    title: r.title,
    raw: r.raw,
    contentHash: r.content_hash,
    postedAt: r.posted_at,
    firstSeenAt: (r.first_seen_at as Date).toISOString(),
    closedAt: r.closed_at,
    source: r.source,
    jobId: r.job_id,
  };
}

/** Open postings that need (re-)enrichment, in (first_seen_at, id) order so the earliest posting becomes primary. */
export async function loadPendingPostings(
  client: Queryable,
  companyId: string,
  enrichVersion: number,
  limit: number,
): Promise<PendingPosting[]> {
  const { rows } = await client.query(
    `${POSTING_SELECT}
      WHERE b.company_id = $1 AND p.closed_at IS NULL AND ${PENDING}
      ORDER BY p.first_seen_at, p.id
      LIMIT $3`,
    [companyId, enrichVersion, limit],
  );
  return rows.map(toPending);
}

/** One posting by id, with whether it still needs enrichment for this version. Null when it does not exist. */
export async function loadPostingById(
  client: Queryable,
  postingId: string,
  enrichVersion: number,
): Promise<(PendingPosting & { pending: boolean }) | null> {
  const { rows } = await client.query(`${POSTING_SELECT} WHERE p.id = $1`, [postingId]);
  const r = rows[0];
  if (!r) return null;
  return {
    ...toPending(r),
    pending: r.closed_at === null && (r.enriched_version !== enrichVersion || r.enriched_content_hash !== r.content_hash),
  };
}

/** Open canonical jobs of the same company and normalised title, compared by their primary posting only (never transitive). */
export async function findClusterCandidates(client: Queryable, companyId: string, titleNorm: string): Promise<ClusterCandidate[]> {
  const { rows } = await client.query(
    `SELECT j.id, j.primary_posting_id, j.simhash::text AS simhash, j.token_count, p.first_seen_at
       FROM jobs j JOIN postings p ON p.id = j.primary_posting_id
      WHERE j.company_id = $1 AND j.title_norm = $2 AND j.closed_at IS NULL AND j.simhash IS NOT NULL
      ORDER BY p.first_seen_at, j.id`,
    [companyId, titleNorm],
  );
  return rows.map((r) => ({
    jobId: r.id,
    primaryPostingId: r.primary_posting_id,
    simhash: r.simhash,
    tokenCount: r.token_count,
    primaryFirstSeenAt: (r.first_seen_at as Date).toISOString(),
  }));
}

const COLUMNS: { col: string; cast?: string; get: (w: JobWrite) => unknown }[] = [
  { col: 'company_id', get: (w) => w.companyId },
  { col: 'title', get: (w) => w.title },
  { col: 'title_norm', get: (w) => w.titleNorm },
  { col: 'role_family', get: (w) => w.roleFamily },
  { col: 'level', get: (w) => w.level },
  { col: 'workplace', get: (w) => w.workplace },
  { col: 'employment', get: (w) => w.employment },
  { col: 'remote', get: (w) => w.remote },
  { col: 'remote_scope', get: (w) => w.remoteScope },
  { col: 'countries', cast: 'char(2)[]', get: (w) => w.countries },
  { col: 'locations', cast: 'jsonb', get: (w) => JSON.stringify(w.locations ?? []) },
  { col: 'visa', get: (w) => w.visa },
  { col: 'description_md', get: (w) => w.descriptionMd },
  { col: 'description_text', get: (w) => w.descriptionText },
  { col: 'doc_hash', get: (w) => w.docHash },
  { col: 'salary_min_minor', get: (w) => w.salary?.minMinor ?? null },
  { col: 'salary_max_minor', get: (w) => w.salary?.maxMinor ?? null },
  { col: 'salary_currency', get: (w) => w.salary?.currency ?? null },
  { col: 'salary_period', get: (w) => w.salary?.period ?? null },
  { col: 'salary_annual_usd_min', get: (w) => w.salary?.annualUsdMin ?? null },
  { col: 'salary_annual_usd_max', get: (w) => w.salary?.annualUsdMax ?? null },
  { col: 'salary_annual_inr_min', get: (w) => w.salary?.annualInrMin ?? null },
  { col: 'salary_annual_inr_max', get: (w) => w.salary?.annualInrMax ?? null },
  { col: 'salary_source', get: (w) => w.salary?.source ?? null },
  { col: 'salary_kind', get: (w) => w.salary?.kind ?? null },
  { col: 'salary_ctc', get: (w) => w.salary?.ctc ?? null },
  { col: 'salary_trace', cast: 'jsonb', get: (w) => (w.salary?.trace == null ? null : JSON.stringify(w.salary.trace)) },
  { col: 'fx_date', cast: 'date', get: (w) => w.salary?.fxDate ?? null },
  { col: 'salary_stated', get: (w) => w.salaryStated },
  { col: 'skills', get: (w) => w.skills },
  { col: 'simhash', cast: 'bigint', get: (w) => w.simhash },
  { col: 'token_count', get: (w) => w.tokenCount },
  { col: 'traces', cast: 'jsonb', get: (w) => JSON.stringify(w.traces ?? {}) },
  { col: 'llm_eligibility', cast: 'jsonb', get: (w) => (w.llmEligibility == null ? null : JSON.stringify(w.llmEligibility)) },
  { col: 'posted_at', get: (w) => w.postedAt },
  { col: 'enrich_version', get: (w) => w.enrichVersion },
  { col: 'primary_posting_id', get: (w) => w.primaryPostingId },
  { col: 'source', get: (w) => w.source },
];

const ph = (i: number, cast?: string): string => `$${i}${cast ? `::${cast}` : ''}`;

/** Inserts a job. first/last_seen_at are placeholders until refreshJobLifecycle derives them from the postings. */
export async function insertJob(client: Queryable, w: JobWrite): Promise<string> {
  const cols = ['slug', ...COLUMNS.map((c) => c.col), 'first_seen_at', 'last_seen_at', 'search_text', 'content_updated_at'];
  const t = COLUMNS.findIndex((c) => c.col === 'title') + 2;
  const co = COLUMNS.findIndex((c) => c.col === 'company_id') + 2;
  const sk = COLUMNS.findIndex((c) => c.col === 'skills') + 2;
  const vals =
    ph(1) + COLUMNS.map((c, i) => `, ${ph(i + 2, c.cast)}`).join('') +
    `, now(), now(), job_search_text($${t}, $${co}, $${sk}), now()`;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO jobs (${cols.join(', ')}) VALUES (${vals}) RETURNING id`,
    [w.slug, ...COLUMNS.map((c) => c.get(w))],
  );
  return rows[0]!.id;
}

/** Overwrites every derived column; identity (id, slug, created_at) and lifecycle are untouched. */
export async function updateJob(client: Queryable, id: string, w: JobWrite): Promise<void> {
  const sets = COLUMNS.map((c, i) => `${c.col} = ${ph(i + 2, c.cast)}`).join(', ');
  const t = COLUMNS.findIndex((c) => c.col === 'title') + 2;
  const co = COLUMNS.findIndex((c) => c.col === 'company_id') + 2;
  const sk = COLUMNS.findIndex((c) => c.col === 'skills') + 2;
  await client.query(
    `UPDATE jobs SET ${sets}, search_text = job_search_text($${t}, $${co}, $${sk}), content_updated_at = now(), updated_at = now() WHERE id = $1`, [id, ...COLUMNS.map((c) => c.get(w))]);
}

export async function replaceRequirements(client: Queryable, jobId: string, reqs: readonly RequirementWrite[]): Promise<void> {
  await client.query('UPDATE jobs SET content_updated_at = now() WHERE id = $1', [jobId]);
  await client.query('DELETE FROM job_requirements WHERE job_id = $1', [jobId]);
  if (reqs.length === 0) return;
  await client.query(
    `INSERT INTO job_requirements (job_id, ord, kind, text, category, skill_ids, years_min, span_start, span_end, section, extractor, confidence, rule_ids)
     SELECT $1, (x->>'ord')::int, x->>'kind', x->>'text', x->>'category',
            ARRAY(SELECT jsonb_array_elements_text(x->'skillIds')), (x->>'yearsMin')::int,
            (x->>'spanStart')::int, (x->>'spanEnd')::int, x->>'section', x->>'extractor',
            (x->>'confidence')::real, ARRAY(SELECT jsonb_array_elements_text(x->'ruleIds'))
       FROM jsonb_array_elements($2::jsonb) x`,
    [jobId, JSON.stringify(reqs)],
  );
}

/** Points a posting at a job and records what it was enriched from. */
export async function linkPosting(
  client: Queryable,
  postingId: string,
  jobId: string,
  contentHash: string,
  enrichVersion: number,
  geo?: PostingGeo,
): Promise<void> {
  await client.query(
    `UPDATE postings SET job_id = $2, enriched_content_hash = $3, enriched_version = $4,
            geo_countries = $5::char(2)[], geo_locations = $6::text[], updated_at = now() WHERE id = $1`,
    [postingId, jobId, contentHash, enrichVersion, geo ? geo.countries : null, geo ? geo.locations : null],
  );
}

/**
 * first_seen = earliest posting, last_seen = latest, closed_at = null while any posting is open (else the latest close).
 * Then drops jobs that no posting points at. Scope to one company, or pass none for all.
 */
export async function refreshJobLifecycle(client: Queryable, companyId?: string): Promise<{ updated: number; orphansDeleted: number }> {
  const scope = companyId ? 'AND j.company_id = $1' : '';
  const args = companyId ? [companyId] : [];
  const upd = await client.query(
    `UPDATE jobs j SET first_seen_at = a.f, last_seen_at = a.l, closed_at = a.c, updated_at = now(),
            content_updated_at = CASE WHEN j.closed_at IS DISTINCT FROM a.c THEN now() ELSE j.content_updated_at END
       FROM (SELECT job_id, min(first_seen_at) AS f, max(last_seen_at) AS l,
                    CASE WHEN bool_or(closed_at IS NULL) THEN NULL ELSE max(closed_at) END AS c
               FROM postings WHERE job_id IS NOT NULL GROUP BY job_id) a
      WHERE j.id = a.job_id ${scope}
        AND (j.first_seen_at, j.last_seen_at, j.closed_at) IS DISTINCT FROM (a.f, a.l, a.c)`,
    args,
  );
  // A canonical job speaks for all its open postings (or all of them, once every one is closed): union their geo.
  // Postings enriched before geo was recorded carry NULL, and then the job keeps what it has.
  const geo = await client.query(
    `UPDATE jobs j SET countries = g.countries, locations = (CASE WHEN jsonb_typeof(j.locations) = 'object' THEN j.locations ELSE '{}'::jsonb END) || jsonb_build_object('all', to_jsonb(g.locs)), updated_at = now(), content_updated_at = now()
       FROM (SELECT p.job_id,
                    coalesce(array_agg(DISTINCT c ORDER BY c) FILTER (WHERE c IS NOT NULL), '{}')::char(2)[] AS countries,
                    coalesce(array_agg(DISTINCT l ORDER BY l) FILTER (WHERE l IS NOT NULL), '{}') AS locs
               FROM postings p
               LEFT JOIN LATERAL unnest(p.geo_countries) AS c ON true
               LEFT JOIN LATERAL unnest(p.geo_locations) AS l ON true
              WHERE p.job_id IS NOT NULL AND p.geo_countries IS NOT NULL
                AND (p.closed_at IS NULL OR NOT EXISTS (SELECT 1 FROM postings o WHERE o.job_id = p.job_id AND o.closed_at IS NULL))
              GROUP BY p.job_id) g
      WHERE j.id = g.job_id ${scope}
        AND (j.countries, j.locations -> 'all') IS DISTINCT FROM (g.countries, to_jsonb(g.locs))`,
    args,
  );
  const del = await client.query(
    `DELETE FROM jobs j WHERE NOT EXISTS (SELECT 1 FROM postings p WHERE p.job_id = j.id) ${scope}`,
    args,
  );
  return { updated: (upd.rowCount ?? 0) + (geo.rowCount ?? 0), orphansDeleted: del.rowCount ?? 0 };
}
