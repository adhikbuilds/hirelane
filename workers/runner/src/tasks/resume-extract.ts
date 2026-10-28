/**
 * `resume:extract` (S3.5). jobKey `resume:extract:{id}`, payload `{ resumeId }`.
 *
 * A no-op unless the row is `uploaded` (the claim is an atomic uploaded -> extracting UPDATE, so a retry or a
 * duplicate job does nothing). Opens the sealed blob, runs the child-process extractor and the pure pipeline, then
 * writes the extractor-owned columns as the OWNER role (hirelane_app has no grant on them). Rules only, 0 LLM calls.
 *
 * Failure policy, so a row is never stuck in `extracting`:
 *   - blob missing/unreadable/tampered: failed + reject_code blob_unreadable (permanent, no retry loop)
 *   - anything else: the claim is released and the job rethrows (graphile retries); on the last attempt the row is
 *     failed + internal_error. Thrown errors carry no message from the cause (it could echo file content).
 */
import type { Task, TaskList } from 'graphile-worker';
import { runPipeline, type ParsedResumeDoc, type PipelineOptions, type PipelineOutcome } from '../resume/pipeline';
import {
  createPgRepo,
  defaultVault,
  fileAad,
  isLastAttempt,
  parseResumePayload,
  parsedAad,
  type ExtractClaim,
  type ExtractWrite,
  type ResumeHelpers,
  type ResumeRepo,
  type ResumeVault,
} from './resume-common';

export interface ExtractDeps {
  repo: ResumeRepo;
  vault: ResumeVault;
  now: () => Date;
  extract?: PipelineOptions['extract'];
}

const SENSITIVE_IDS = new Set(['aadhaar', 'vid', 'pan']);

interface Prior { fileName: string | null; builder?: unknown }

/** What the upload service or resume:render sealed before extraction. Anything unreadable just means "no file name". */
async function readPrior(c: ExtractClaim, vault: ResumeVault): Promise<Prior> {
  if (!c.parsedEnc) return { fileName: null };
  try {
    const v = (await vault.openJson(c.parsedEnc, parsedAad(c.id, c.userId))) as Record<string, unknown> | null;
    const fileName = typeof v?.['fileName'] === 'string' ? (v['fileName'] as string).slice(0, 255) : null;
    return v && 'answers' in v ? { fileName, builder: v['answers'] } : { fileName };
  } catch {
    return { fileName: null };
  }
}

function toWrite(o: PipelineOutcome, parsedEnc: Buffer | null): ExtractWrite {
  if (o.kind === 'rejected') {
    return { status: o.status, rejectCode: o.rejectCode, pages: null, textLayer: null, producerFamily: null, health: [], healthPassed: 0, healthTotal: 0, sensitiveKinds: [], parsedEnc: null };
  }
  return {
    status: o.status,
    rejectCode: null,
    pages: o.pages,
    textLayer: o.textLayer,
    producerFamily: o.producerFamily,
    health: o.health,
    healthPassed: o.healthPassed,
    healthTotal: o.healthTotal,
    sensitiveKinds: o.sensitiveKinds,
    parsedEnc,
  };
}

export async function extractResume(id: string, deps: ExtractDeps, helpers: ResumeHelpers): Promise<string> {
  const { repo, vault } = deps;
  const claim = await repo.claimExtract(id, deps.now());
  if (!claim) {
    helpers.logger.info(`resume:extract ${id} noop`);
    return 'noop';
  }
  try {
    let bytes: Buffer;
    try {
      bytes = await vault.getBlob(claim.blobKey, fileAad(claim.id, claim.userId));
    } catch {
      await repo.failExtract(id, 'blob_unreadable', deps.now());
      helpers.logger.warn(`resume:extract ${id} failed blob_unreadable`);
      return 'failed';
    }
    const prior = await readPrior(claim, vault);
    const outcome = await runPipeline(bytes, { fileName: prior.fileName, ...(deps.extract ? { extract: deps.extract } : {}) });
    let parsedEnc: Buffer | null = null;
    if (outcome.kind === 'parsed') {
      const doc: ParsedResumeDoc = prior.builder === undefined ? outcome.doc : { ...outcome.doc, builder: prior.builder };
      parsedEnc = await vault.sealJson(doc, parsedAad(claim.id, claim.userId));
    }
    const written = await repo.finishExtract(claim, toWrite(outcome, parsedEnc), deps.now());
    if (!written) {
      helpers.logger.warn(`resume:extract ${id} state_changed`);
      return 'state_changed';
    }
    // A clean parse may replace an older original that held an Aadhaar/PAN: purge it (within 24 h, see resume-purge).
    if (outcome.kind === 'parsed' && !outcome.sensitiveKinds.some((k) => SENSITIVE_IDS.has(k))) {
      for (const old of await repo.supersedeSensitive(claim.userId, deps.now())) {
        await helpers.addJob('resume:purge', { resumeId: old }, { jobKey: `resume:purge:${old}` });
      }
    }
    helpers.logger.info(`resume:extract ${id} ${outcome.status}${outcome.kind === 'rejected' ? ` ${outcome.rejectCode}` : ''}`);
    return outcome.status;
  } catch {
    if (isLastAttempt(helpers)) {
      await repo.failExtract(id, 'internal_error', deps.now());
      helpers.logger.error(`resume:extract ${id} failed internal_error`);
      return 'failed';
    }
    await repo.releaseExtract(id, deps.now());
    helpers.logger.warn(`resume:extract ${id} retry`);
    throw new Error('resume:extract failed');
  }
}

export function createResumeExtractTasks(over: Partial<ExtractDeps> = {}): TaskList {
  let repo: ResumeRepo | undefined;
  const deps = (): ExtractDeps => ({
    repo: over.repo ?? (repo ??= createPgRepo()),
    vault: over.vault ?? defaultVault(),
    now: over.now ?? (() => new Date()),
    ...(over.extract ? { extract: over.extract } : {}),
  });
  const task: Task = async (payload, helpers) => {
    const id = parseResumePayload(payload);
    await extractResume(id, deps(), helpers as unknown as ResumeHelpers);
  };
  return { 'resume:extract': task };
}
