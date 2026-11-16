/**
 * `resume:stuck-sweep` (HLD section 7): hourly recovery for resumes that would otherwise read "reading..." forever.
 *   - the worker died between claimExtract and finishExtract: the row sits in 'extracting' and graphile's retry finds
 *     nothing to claim. Rows older than 5 min (the child has a 10 s limit) go back to 'uploaded';
 *   - uploadResume or resume:render committed the row but the enqueue failed: the row sits in 'uploaded' with no job.
 *     Rows older than 10 min get a fresh resume:extract (jobKey dedupes with a job that does exist).
 * Also `idempotency:sweep`: idempotency_keys keep full JSON response bodies (labels, skills, percentages), so they are
 * deleted after 24 h. Logs carry counts only.
 */
import type { Task, TaskList } from 'graphile-worker';
import { IDEMPOTENCY_TTL_HOURS, STUCK_EXTRACTING_MIN, STUCK_UPLOADED_MIN, createPgRepo, type ResumeHelpers, type ResumeRepo } from './resume-common';

export interface StuckDeps {
  repo: ResumeRepo;
  now: () => Date;
}

const LIMIT = 500;

export async function sweepStuck(deps: StuckDeps, helpers: Pick<ResumeHelpers, 'logger' | 'addJob'>): Promise<{ requeued: number; failed: number }> {
  const ids = await deps.repo.reviveStuck(deps.now(), { uploadedMin: STUCK_UPLOADED_MIN, extractingMin: STUCK_EXTRACTING_MIN, limit: LIMIT });
  let failed = 0;
  for (const id of ids) {
    try {
      await helpers.addJob('resume:extract', { resumeId: id }, { jobKey: `resume:extract:${id}` });
    } catch {
      failed++;
    }
  }
  helpers.logger.info(`resume:stuck-sweep requeued ${ids.length - failed} failed ${failed}`);
  return { requeued: ids.length - failed, failed };
}

export function createResumeStuckTasks(over: Partial<StuckDeps> = {}): TaskList {
  let repo: ResumeRepo | undefined;
  const deps = (): StuckDeps => ({ repo: over.repo ?? (repo ??= createPgRepo()), now: over.now ?? (() => new Date()) });
  const stuck: Task = async (_payload, helpers) => {
    const r = await sweepStuck(deps(), helpers as unknown as ResumeHelpers);
    if (r.failed > 0) throw new Error(`resume:stuck-sweep failed: ${r.failed}`);
  };
  const idem: Task = async (_payload, helpers) => {
    const n = await deps().repo.purgeIdempotency(deps().now(), IDEMPOTENCY_TTL_HOURS);
    (helpers as unknown as ResumeHelpers).logger.info(`idempotency:sweep deleted ${n}`);
  };
  return { 'resume:stuck-sweep': stuck, 'idempotency:sweep': idem };
}
