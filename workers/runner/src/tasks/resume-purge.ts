/**
 * `resume:purge` and `resume:purge-sweep` (S3.10). Retention: a deleted resume is gone within 24 h (PRD R8).
 *
 *   - resume:purge `{ resumeId }`, jobKey `resume:purge:{id}`: enqueued by the delete service and by resume:extract.
 *     Acts only on a resume that is already soft-deleted. Collects the blob keys of the resume AND its versions,
 *     deletes the blobs FIRST, then one UPDATE nulls parsed_enc and sets purged_at (so a failed delete is retried
 *     with the keys still on the rows). Writes a `purge` row to file_access_log.
 *   - resume:purge-sweep: HOURLY backstop (see crontab). Picks up every row with purge_after <= now, and every row
 *     deleted 23 h ago or more even if the service set a later purge_after, so the bound holds after an hourly gap.
 *     First it soft-deletes any original holding an Aadhaar/VID/PAN that the student has replaced with a newer, clean,
 *     parsed or confirmed resume (S3.10: "purge the old original when a student replaces a resume that contained an
 *     Aadhaar or PAN number").
 * Row removal never happens here; the rows stay (purged_at set) so history and the audit trail survive.
 * Logs carry ids and status codes only.
 */
import type { Task, TaskList } from 'graphile-worker';
import { createPgRepo, defaultVault, parseResumePayload, type ResumeHelpers, type ResumeRepo, type ResumeVault } from './resume-common';

export interface PurgeDeps {
  repo: ResumeRepo;
  vault: ResumeVault;
  now: () => Date;
}

const BATCH = 200;
const MAX_BATCHES = 10;

export async function purgeResume(id: string, deps: PurgeDeps, helpers: Pick<ResumeHelpers, 'logger'>): Promise<'purged' | 'noop'> {
  const targets = await deps.repo.loadPurgeTree(id);
  if (targets.length === 0) {
    helpers.logger.info(`resume:purge ${id} noop`);
    return 'noop';
  }
  try {
    for (const t of targets) if (t.blobKey) await deps.vault.deleteBlob(t.blobKey);
    await deps.repo.completePurge(targets, deps.now());
  } catch {
    helpers.logger.warn(`resume:purge ${id} retry`);
    throw new Error('resume:purge failed');
  }
  helpers.logger.info(`resume:purge ${id} purged ${targets.length}`);
  return 'purged';
}

export async function sweepResumes(deps: PurgeDeps, helpers: Pick<ResumeHelpers, 'logger'>): Promise<{ purged: number; failed: number }> {
  await deps.repo.supersedeSensitive(null, deps.now());
  const tried = new Set<string>();
  let purged = 0;
  let failed = 0;
  for (let b = 0; b < MAX_BATCHES; b++) {
    const ids = await deps.repo.dueForPurge(deps.now(), BATCH, [...tried]);
    if (ids.length === 0) break;
    for (const id of ids) {
      tried.add(id);
      try {
        if ((await purgeResume(id, deps, helpers)) === 'purged') purged++;
      } catch {
        failed++;
      }
    }
  }
  helpers.logger.info(`resume:purge-sweep purged ${purged} failed ${failed}`);
  return { purged, failed };
}

export function createResumePurgeTasks(over: Partial<PurgeDeps> = {}): TaskList {
  let repo: ResumeRepo | undefined;
  const deps = (): PurgeDeps => ({
    repo: over.repo ?? (repo ??= createPgRepo()),
    vault: over.vault ?? defaultVault(),
    now: over.now ?? (() => new Date()),
  });
  const purge: Task = async (payload, helpers) => {
    await purgeResume(parseResumePayload(payload), deps(), helpers as unknown as ResumeHelpers);
  };
  const sweep: Task = async (_payload, helpers) => {
    const r = await sweepResumes(deps(), helpers as unknown as ResumeHelpers);
    if (r.failed > 0) throw new Error(`resume:purge-sweep failed: ${r.failed} of ${r.purged + r.failed}`);
  };
  return { 'resume:purge': purge, 'resume:purge-sweep': sweep };
}
