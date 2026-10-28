/**
 * Enrichment composition (contract section 12 order) and the per-company worker loop.
 * The engine is pure; this file owns I/O: reading pending postings, clustering, and writing jobs.
 */
import type { Client, PoolClient } from 'pg';
import {
  ENRICH_VERSION,
  canonicalTitle,
  classifyEmployment,
  classifyLevel,
  classifyRoleFamily,
  classifyWorkplace,
  countTokens,
  dedupMatch,
  defaultFxSnapshot,
  defaultPlaceIndex,
  defaultSkillIndex,
  detectVisa,
  extractRequirements,
  extractSkills,
  hamming,
  isSalaryStated,
  isTrace,
  normalizeSalary,
  parseSalary,
  pickPrimary,
  resolveCountries,
  salaryCues,
  SALARY_LLM_BELOW,
  simhash64,
  simhashFromPg,
  toDoc,
  type ClassifyInput,
  type DedupKey,
  type FxSnapshot,
  type StructuredComp,
  type Trace,
} from '@hirelane/engine';
import skillsData from '@hirelane/engine/data/skills.json';
import type { Ats, RawPosting } from '@hirelane/ingest/src/contract';
import {
  findClusterCandidates,
  insertJob,
  linkPosting,
  loadFxSnapshot,
  loadPendingPostings,
  loadPostingById,
  lockCompany,
  refreshJobLifecycle,
  replaceRequirements,
  seedFxRates,
  seedSkills,
  updateJob,
  type JobWrite,
  type PendingPosting,
  type RequirementWrite,
  type SkillRow,
} from '@hirelane/db';
import { rawToPosting } from './enrich-raw.js';

type Queryable = Client | PoolClient;

export interface EnrichInput {
  title: string;
  descriptionHtml: string | null;
  locationsRaw: readonly string[];
  department: string | null;
  team: string | null;
  employmentRaw: string | null;
  workplaceRaw: string | null;
  isRemoteHint: boolean | null;
  compensation: StructuredComp | null;
}

export function buildInput(p: RawPosting): EnrichInput {
  return {
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    locationsRaw: p.locationsRaw,
    department: p.department,
    team: p.team,
    employmentRaw: p.employmentRaw,
    workplaceRaw: p.workplaceRaw,
    isRemoteHint: p.isRemoteHint,
    compensation: p.compensation,
  };
}

export interface LlmEligibility {
  salary: boolean;
  requirements: boolean;
  skills: boolean;
  reasons: string[];
}

/** Runs the pure engine in the contract order. Never calls an LLM; only records whether a fallback would be eligible. */
export function enrichPosting(input: EnrichInput, deps: { fx: FxSnapshot }) {
  const doc = toDoc(input.descriptionHtml);
  const places = defaultPlaceIndex();
  const skillIndex = defaultSkillIndex();
  const title = canonicalTitle(input.title, places);
  const base = {
    title: input.title,
    titleNorm: title.norm,
    department: input.department,
    team: input.team,
    employmentRaw: input.employmentRaw,
    workplaceRaw: input.workplaceRaw,
    isRemoteHint: input.isRemoteHint,
    locationsRaw: input.locationsRaw,
    doc,
  };
  const first: ClassifyInput = { ...base, yearsMin: null };
  const workplace = classifyWorkplace(first);
  const countries = resolveCountries(input.locationsRaw, places, workplace.value);
  const salaryParse = parseSalary(doc.text, input.compensation, { countries: countries.countries });
  const salary = salaryParse ? normalizeSalary(salaryParse, deps.fx) : null;
  const skills = extractSkills(doc, skillIndex, input.title);
  const requirements = extractRequirements(doc, skillIndex);
  const musts = requirements.requirements.filter((r) => r.kind === 'must' && r.yearsMin !== null);
  const yearsMin = musts.length ? Math.max(...musts.map((r) => r.yearsMin as number)) : null;
  const second: ClassifyInput = { ...base, yearsMin };
  const level = classifyLevel(second);
  const employment = classifyEmployment(second);
  const roleFamily = classifyRoleFamily(second, skills);
  const visa = detectVisa(doc);
  const simhash = simhash64(doc.text);
  const tokenCount = countTokens(doc.text);

  const cues = salaryCues(doc.text);
  const llm: LlmEligibility = { salary: false, requirements: requirements.lowConfidence, skills: false, reasons: [] };
  if (!salaryParse && cues.length > 0) {
    llm.salary = true;
    llm.reasons.push('salary.cue_without_parse');
  } else if (salaryParse && salaryParse.confidence < SALARY_LLM_BELOW) {
    llm.salary = true;
    llm.reasons.push('salary.low_confidence');
  }
  if (requirements.lowConfidence) llm.reasons.push('requirements.low_confidence');

  const salaryStated = isSalaryStated(salaryParse, input.compensation);
  return { doc, title, workplace, countries, salaryParse, salary, skills, requirements, level, employment, roleFamily, visa, simhash, tokenCount, llm, salaryStated };
}
export type Enrichment = ReturnType<typeof enrichPosting>;

const slugPart = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

export function jobSlug(companySlug: string, titleNorm: string, postingId: string): string {
  return [slugPart(companySlug), slugPart(titleNorm), postingId.replace(/-/g, '').slice(0, 8)].filter(Boolean).join('-');
}

function checkedTraces(e: Enrichment): Record<string, Trace> {
  const traces: Record<string, Trace> = {
    title: e.title.trace,
    workplace: e.workplace.trace,
    countries: e.countries.trace,
    skills: e.skills.trace,
    requirements: e.requirements.trace,
    level: e.level.trace,
    employment: e.employment.trace,
    role_family: e.roleFamily.trace,
    visa: e.visa.trace,
  };
  for (const [k, t] of Object.entries(traces)) if (!isTrace(t)) throw new Error(`invalid ${k} trace`);
  return traces;
}

export function buildJobWrite(p: PendingPosting, e: Enrichment, enrichVersion: number, slug?: string): { write: JobWrite; reqs: RequirementWrite[] } {
  void slug;
  const s = e.salary;
  if (s && !isTrace(s.trace)) throw new Error('invalid salary trace');
  const write: JobWrite = {
    companyId: p.companyId,
    slug: '',
    title: p.title,
    titleNorm: e.title.norm,
    roleFamily: e.roleFamily.value,
    level: e.level.value,
    workplace: e.workplace.value,
    employment: e.employment.value,
    remote: e.workplace.value === 'remote',
    remoteScope: e.countries.remoteScope,
    countries: e.countries.countries,
    locations: { perLocation: e.countries.perLocation, unresolved: e.countries.unresolved, regions: e.countries.regions },
    visa: e.visa.value,
    descriptionMd: e.doc.text,
    descriptionText: e.doc.text,
    docHash: e.doc.hash,
    salary: s
      ? {
          minMinor: s.stated.minorMin,
          maxMinor: s.stated.minorMax,
          currency: s.currency,
          period: s.stated.period,
          annualUsdMin: s.annualMin.USD,
          annualUsdMax: s.annualMax.USD,
          annualInrMin: s.annualMin.INR,
          annualInrMax: s.annualMax.INR,
          source: s.source,
          kind: s.kind,
          ctc: e.salaryParse?.ctc ?? false,
          trace: s.trace,
          fxDate: s.fxAsOf,
        }
      : null,
    salaryStated: e.salaryStated,
    skills: e.skills.ids,
    simhash: e.simhash.pg,
    tokenCount: e.tokenCount,
    traces: checkedTraces(e),
    llmEligibility: e.llm,
    postedAt: p.postedAt,
    enrichVersion,
    primaryPostingId: p.postingId,
    source: p.source,
  };
  const reqs: RequirementWrite[] = e.requirements.requirements.map((r) => ({
    ord: r.ord,
    kind: r.kind,
    text: r.text,
    category: r.category,
    skillIds: r.skillIds,
    yearsMin: r.yearsMin,
    spanStart: r.spanStart,
    spanEnd: r.spanEnd,
    section: r.section,
    extractor: r.extractor,
    confidence: r.confidence,
    ruleIds: r.ruleIds,
  }));
  return { write, reqs };
}

// ---------------------------------------------------------------------------------------------
// reference data

/** Seeds skills (from the engine's data file) and the fixture FX snapshot when fx_rates is empty. Idempotent. */
export async function ensureReferenceData(client: Queryable): Promise<void> {
  await seedSkills(client, (skillsData as { skills: SkillRow[] }).skills.map((s) => ({ id: s.id, label: s.label, aliases: s.aliases, category: s.category, adjacent: s.adjacent })));
  if ((await loadFxSnapshot(client)) === null) {
    const snap = defaultFxSnapshot();
    await seedFxRates(client, { asOf: snap.asOf, source: snap.source, perUsd: { ...snap.perUsd } as Record<string, string> });
  }
}

/** The FX snapshot the enrichment runs against comes from fx_rates, not from the data file. */
export async function loadEngineFx(client: Queryable): Promise<FxSnapshot> {
  const snap = await loadFxSnapshot(client);
  if (!snap) throw new Error('fx_rates is empty; run ensureReferenceData first');
  return { asOf: snap.asOf, source: snap.source, perUsd: snap.perUsd as FxSnapshot['perUsd'] };
}

// ---------------------------------------------------------------------------------------------
// per-company loop

export interface EnrichStats {
  seen: number;
  enriched: number;
  created: number;
  attached: number;
  errors: number;
  errorSamples: string[];
}

export interface EnrichOptions {
  enrichVersion?: number;
  batch?: number;
  fx?: FxSnapshot;
  onProgress?: (done: number) => void;
}

async function inTx<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const out = await fn();
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

export async function enrichCompany(client: Queryable, companyId: string, opts: EnrichOptions = {}): Promise<EnrichStats> {
  const version = opts.enrichVersion ?? ENRICH_VERSION;
  const batch = opts.batch ?? 100;
  const fx = opts.fx ?? (await loadEngineFx(client));
  const stats: EnrichStats = { seen: 0, enriched: 0, created: 0, attached: 0, errors: 0, errorSamples: [] };
  const attempted = new Set<string>();

  // Postings closed since the last run close their job before anything is compared against it.
  await inTx(client, async () => {
    await lockCompany(client, companyId);
    await refreshJobLifecycle(client, companyId);
  });

  for (;;) {
    const rows = (await loadPendingPostings(client, companyId, version, batch + attempted.size)).filter((r) => !attempted.has(r.postingId));
    if (rows.length === 0) break;
    for (const p of rows.slice(0, batch)) {
      attempted.add(p.postingId);
      stats.seen++;
      try {
        const out = await inTx(client, () => enrichOne(client, p, fx, version));
        stats.enriched++;
        if (out === 'created') stats.created++;
        else if (out === 'attached') stats.attached++;
      } catch (e) {
        stats.errors++;
        if (stats.errorSamples.length < 5) stats.errorSamples.push(`${p.key}: ${e instanceof Error ? e.message : String(e)}`);
      }
      opts.onProgress?.(stats.seen);
    }
  }

  await inTx(client, async () => {
    await lockCompany(client, companyId);
    await refreshJobLifecycle(client, companyId);
  });
  return stats;
}

async function enrichOne(client: Queryable, p: PendingPosting, fx: FxSnapshot, version: number): Promise<'updated' | 'created' | 'attached'> {
  await lockCompany(client, p.companyId);
  const raw = await rawToPosting(p.ats as Ats, p.token, p.raw);
  if (!raw) throw new Error('connector could not rebuild the posting from raw');
  const e = enrichPosting(buildInput(raw), { fx });
  const { write, reqs } = buildJobWrite(p, e, version);
  const geo = { countries: e.countries.countries, locations: [...raw.locationsRaw] };

  // 1. The posting is already the primary of its job: refresh that job in place (id and slug are stable).
  if (p.jobId) {
    const { rows } = await client.query<{ primary_posting_id: string | null }>('SELECT primary_posting_id FROM jobs WHERE id = $1', [p.jobId]);
    if (rows[0]?.primary_posting_id === p.postingId) {
      await updateJob(client, p.jobId, write);
      await replaceRequirements(client, p.jobId, reqs);
      await linkPosting(client, p.postingId, p.jobId, p.contentHash, version, geo);
      return 'updated';
    }
  }

  // 2. Cluster against the primary key of open jobs with the same company and normalised title. Never transitive.
  const mine: DedupKey = { companyId: p.companyId, titleNorm: e.title.norm, simhash: e.simhash, tokenCount: e.tokenCount };
  const scored: { jobId: string; primaryPostingId: string; primaryFirstSeenAt: string; distance: number }[] = [];
  for (const c of await findClusterCandidates(client, p.companyId, e.title.norm)) {
    if (c.primaryPostingId === p.postingId) continue;
    const theirs: DedupKey = { companyId: p.companyId, titleNorm: e.title.norm, simhash: simhashFromPg(c.simhash), tokenCount: c.tokenCount };
    const d = dedupMatch(theirs, mine);
    if (d.match) scored.push({ jobId: c.jobId, primaryPostingId: c.primaryPostingId, primaryFirstSeenAt: c.primaryFirstSeenAt, distance: d.distance ?? hamming(theirs.simhash, mine.simhash) });
  }
  scored.sort((a, b) => a.distance - b.distance || (a.primaryFirstSeenAt < b.primaryFirstSeenAt ? -1 : a.primaryFirstSeenAt > b.primaryFirstSeenAt ? 1 : 0) || (a.jobId < b.jobId ? -1 : 1));
  const best = scored[0];

  if (best) {
    const winner = pickPrimary([
      { postingId: best.primaryPostingId, firstSeenAt: best.primaryFirstSeenAt },
      { postingId: p.postingId, firstSeenAt: p.firstSeenAt },
    ]);
    if (winner.postingId === p.postingId) {
      // The new posting is older than the current primary: it takes over the canonical fields.
      await updateJob(client, best.jobId, write);
      await replaceRequirements(client, best.jobId, reqs);
    }
    await linkPosting(client, p.postingId, best.jobId, p.contentHash, version, geo);
    return 'attached';
  }

  const id = await insertJob(client, { ...write, slug: jobSlug(p.companySlug, e.title.norm, p.postingId) });
  await replaceRequirements(client, id, reqs);
  await linkPosting(client, p.postingId, id, p.contentHash, version, geo);
  return 'created';
}

/**
 * enrich:posting: one posting by id, in its own transaction. A closed, missing or already-current posting is a no-op,
 * so a duplicate or late job (same jobKey retried) is harmless. Returns what happened.
 */
export async function enrichPostingById(
  client: Queryable,
  postingId: string,
  opts: { enrichVersion?: number; fx?: FxSnapshot } = {},
): Promise<'skipped' | 'updated' | 'created' | 'attached'> {
  const version = opts.enrichVersion ?? ENRICH_VERSION;
  const p = await loadPostingById(client, postingId, version);
  if (!p || !p.pending) return 'skipped';
  const fx = opts.fx ?? (await loadEngineFx(client));
  const out = await inTx(client, () => enrichOne(client, p, fx, version));
  await inTx(client, async () => {
    await lockCompany(client, p.companyId);
    await refreshJobLifecycle(client, p.companyId);
  });
  return out;
}

/** Closes jobs whose postings all closed (and reopens them), drops orphans, refreshes unioned geo. All companies. */
export async function syncJobLifecycle(client: Queryable): Promise<{ updated: number; orphansDeleted: number }> {
  return refreshJobLifecycle(client);
}
