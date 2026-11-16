/**
 * `resume:render` (S3.8), the guided builder. jobKey `resume:render:{id}`, payload `{ resumeId }`.
 *
 * Reads the sealed builder answers from parsed_enc (source=builder, status draft, no file yet), renders a one-page
 * single-column PDF with pdfkit + bundled Noto Sans, seals it, stores it, fills blob_key/size_bytes/file_hmac as the
 * OWNER role, sets status `uploaded`, and enqueues resume:extract so the PDF goes through the same pipeline as an
 * upload. parsed_enc is re-sealed as `{ fileName, answers }` so extract can check the file name and keep the answers
 * for later edits. No-op when the row is not a draft. Logs carry status codes only.
 */
import type { Task, TaskList } from 'graphile-worker';
import { RenderError, builderFileName, parseBuilderAnswers, renderResumePdf } from '../resume/render/index';
import {
  blobKeyFor,
  createPgRepo,
  defaultVault,
  fileAad,
  isLastAttempt,
  parseResumePayload,
  parsedAad,
  type ResumeHelpers,
  type ResumeRepo,
  type ResumeVault,
} from './resume-common';

export interface RenderDeps {
  repo: ResumeRepo;
  vault: ResumeVault;
  now: () => Date;
}

/** `{ answers }` is the contract; a bare answers object is tolerated. */
function answersOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'answers' in body ? (body as { answers: unknown }).answers : body;
}

export async function renderResume(id: string, deps: RenderDeps, helpers: ResumeHelpers): Promise<string> {
  const { repo, vault } = deps;
  const draft = await repo.loadDraft(id);
  if (!draft) {
    helpers.logger.info(`resume:render ${id} noop`);
    return 'noop';
  }
  const key = blobKeyFor(draft.userId, draft.id);
  let stored = false;
  try {
    // An unreadable draft (wrong key, tampered) will not heal on retry: treat it like invalid answers.
    const body = await vault.openJson(draft.parsedEnc, parsedAad(draft.id, draft.userId)).catch(() => {
      throw new RenderError('invalid_answers', 'parsed_enc');
    });
    const answers = parseBuilderAnswers(answersOf(body));
    const pdf = await renderResumePdf(answers);
    await vault.putBlob(key, pdf, fileAad(draft.id, draft.userId));
    stored = true;
    const fileHmac = await vault.fileHmac(pdf);
    const parsedEnc = await vault.sealJson({ fileName: builderFileName(answers), answers }, parsedAad(draft.id, draft.userId));
    const done = await repo.finishRender(draft, { blobKey: key, sizeBytes: pdf.length, fileHmac, parsedEnc }, deps.now());
    if (!done) {
      await vault.deleteBlob(key);
      helpers.logger.warn(`resume:render ${id} state_changed`);
      return 'state_changed';
    }
    // Committed: the row now points at this blob. From here a failure must NOT delete it; resume:stuck-sweep re-queues the extract.
    stored = false;
    await helpers.addJob('resume:extract', { resumeId: id }, { jobKey: `resume:extract:${id}` });
    helpers.logger.info(`resume:render ${id} uploaded`);
    return 'uploaded';
  } catch (e) {
    if (stored) await vault.deleteBlob(key).catch(() => undefined);
    // Bad answers or an unfittable layout are the draft's fault: fail it for good.
    if (e instanceof RenderError && e.code !== 'render_failed') {
      await repo.failRender(id, e.code, deps.now());
      helpers.logger.warn(`resume:render ${id} failed ${e.code}`);
      return 'failed';
    }
    if (isLastAttempt(helpers)) {
      await repo.failRender(id, 'internal_error', deps.now());
      helpers.logger.error(`resume:render ${id} failed internal_error`);
      return 'failed';
    }
    helpers.logger.warn(`resume:render ${id} retry`);
    throw new Error('resume:render failed');
  }
}

export function createResumeRenderTasks(over: Partial<RenderDeps> = {}): TaskList {
  let repo: ResumeRepo | undefined;
  const deps = (): RenderDeps => ({
    repo: over.repo ?? (repo ??= createPgRepo()),
    vault: over.vault ?? defaultVault(),
    now: over.now ?? (() => new Date()),
  });
  const task: Task = async (payload, helpers) => {
    await renderResume(parseResumePayload(payload), deps(), helpers as unknown as ResumeHelpers);
  };
  return { 'resume:render': task };
}
