/**
 * Enrichment worker tasks. `enrich:schedule` seeds reference data and fans out one `enrich:company` job per company
 * that has postings needing (re-)enrichment. Clustering is serialised per company inside enrichCompany, so jobs may
 * run in parallel. Idempotent: a posting is selected again only when its content hash or ENRICH_VERSION changed.
 */
import type { Task, TaskList } from 'graphile-worker';
import { listPendingCompanies, withAdmin } from '@hirelane/db';
import { ENRICH_VERSION } from '@hirelane/engine';
import { enrichCompany, enrichPostingById, ensureReferenceData, syncJobLifecycle, type EnrichStats } from './enrich-core.js';

export interface EnrichDeps {
  prepare: () => Promise<void>;
  pendingCompanies: () => Promise<{ companyId: string; pending: number }[]>;
  enrichCompany: (companyId: string) => Promise<EnrichStats>;
  enrichPosting: (postingId: string) => Promise<string>;
  /** Closure propagation: runs every tick, even when no posting needs enrichment. */
  syncLifecycle: () => Promise<{ updated: number; orphansDeleted: number }>;
}

export const defaultEnrichDeps: EnrichDeps = {
  prepare: () => withAdmin((c) => ensureReferenceData(c)),
  pendingCompanies: () => withAdmin((c) => listPendingCompanies(c, ENRICH_VERSION)),
  enrichCompany: (companyId) => withAdmin((c) => enrichCompany(c, companyId)),
  enrichPosting: (postingId) => withAdmin((c) => enrichPostingById(c, postingId)),
  syncLifecycle: () => withAdmin((c) => syncJobLifecycle(c)),
};

export function createEnrichTasks(deps: EnrichDeps = defaultEnrichDeps): TaskList & Record<string, Task> {
  const schedule: Task = async (_payload, helpers) => {
    await deps.prepare();
    // Ingest soft-closes postings without touching jobs, so closures (and reopens) reach `jobs` here.
    const life = await deps.syncLifecycle();
    helpers.logger.info(`enrich:schedule: lifecycle updated=${life.updated} orphansDeleted=${life.orphansDeleted}`);
    const pending = await deps.pendingCompanies();
    for (const { companyId } of pending) {
      await helpers.addJob('enrich:company', { companyId }, { jobKey: `enrich:company:${companyId}`, maxAttempts: 3 });
    }
    helpers.logger.info(`enrich:schedule: ${pending.length} companies with pending postings`);
  };

  const company: Task = async (payload, helpers) => {
    const id = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)['companyId'] : undefined;
    if (typeof id !== 'string' || id.length === 0) throw new Error('enrich:company: invalid payload');
    const s = await deps.enrichCompany(id);
    helpers.logger.info(`enrich:company: ${id} seen=${s.seen} enriched=${s.enriched} created=${s.created} attached=${s.attached} errors=${s.errors}`);
    if (s.errors > 0) helpers.logger.warn(`enrich:company: ${id} first errors: ${s.errorSamples.join(' | ')}`);
  };

  const posting: Task = async (payload, helpers) => {
    const id = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)['postingId'] : undefined;
    if (typeof id !== 'string' || id.length === 0) throw new Error('enrich:posting: invalid payload');
    helpers.logger.info(`enrich:posting: ${id} ${await deps.enrichPosting(id)}`);
  };

  return { 'enrich:schedule': schedule, 'enrich:company': company, 'enrich:posting': posting };
}
