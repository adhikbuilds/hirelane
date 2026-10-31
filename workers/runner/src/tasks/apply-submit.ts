/**
 * `apply:submit` and `apply:sweep`: right swipe = applied (owner decision 2026-10-29). 0 LLM calls. FIXTURE ONLY: the transport
 * is the executor's default one, which refuses every host that is not a fixture host, so a real employer is never contacted.
 *
 *   - apply:submit `{ applicationId }`, jobKey `apply:submit:{id}`: enqueued by the swipe service. Claims the application in one
 *     atomic UPDATE (ready -> submitting, only after the 4 second undo window), so an undo racing the claim has one winner. Too
 *     early: re-queues itself for the end of the window. Then runs the executor (consent, daily cap, kill switch, answers
 *     from evidence, fixture submit, CAPTCHA / challenge / login becomes "finish on their site") and stores the sealed answers,
 *     the receipt and the outcome in one transaction.
 *   - apply:sweep: backstop. Re-queues ready applications whose submit job was lost, fails ones stuck in submitting.
 * Logs carry ids and codes only.
 */
import { answerFrom, answerQuestion, type AnswerBankEntry, type AnswerProfile, type ResumeFacts } from '@hirelane/engine';
import type { Task, TaskList } from 'graphile-worker';
import { applyMode } from '../../../../packages/agent/src/apply-mode';
import { runSubmit } from '../../../../packages/agent/src/submit/index';
import type { AnswerPort, ResumeFile, SubmitOutcome, SubmitPorts, Transport } from '../../../../packages/agent/src/submit/index';
import { defaultTransport } from '../../../../packages/agent/src/submit/index';
import { bankKeyForLabel, createApplyRepo, parseApplyPayload, submitJobKey, type AnswerRowWrite, type ApplyRepo, type ClaimedApplication, type FinishWrite, type StudentFacts } from './apply-common';
import type { ResumeHelpers } from './resume-common';
import { createHash } from 'node:crypto';

/** The fixture-only transport, re-exported so tests need not import the submit module themselves. */
export { defaultTransport };

export interface SubmitDeps {
  repo: ApplyRepo;
  transport: Transport;
  now: () => Date;
}

export interface Helpers {
  logger: ResumeHelpers['logger'];
  addJob(identifier: string, payload?: unknown, spec?: { jobKey?: string; runAt?: Date }): Promise<unknown>;
}
const RETRY_AFTER_WINDOW_MS = 250;

const asCgpaRule = (v: unknown): { kind: 'linear'; a: number; b: number } | null =>
  v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'linear' && typeof (v as { a?: unknown }).a === 'number' && typeof (v as { b?: unknown }).b === 'number'
    ? (v as { kind: 'linear'; a: number; b: number })
    : null;

/** The engine's deterministic answer set behind the executor's AnswerPort. Rules only; a value needs evidence or it is Needs-you. */
export function answerPortFor(facts: StudentFacts, app: ClaimedApplication): AnswerPort {
  // Contact details the student typed into their answer bank are profile facts for the engine (it validates them).
  const bankValue = (k: string): string | undefined => facts.bank.find((b) => b.questionKey === k)?.answer;
  const elig = facts.eligibility as { degree?: string; passout_year?: number } | null;
  const profile: AnswerProfile = {
    ...(facts.fullName ? { fullName: facts.fullName } : {}),
    // Never the student's own mailbox: the apply address, so employer replies reach inbound:scan.
    ...(facts.applyAddress ? { email: facts.applyAddress } : {}),
    ...(bankValue('phone') ? { phone: bankValue('phone')! } : {}),
    ...(bankValue('linkedin') ? { linkedin: bankValue('linkedin')! } : {}),
    ...(bankValue('github') ? { github: bankValue('github')! } : {}),
    ...(elig?.degree ? { degree: elig.degree } : {}),
    ...(typeof elig?.passout_year === 'number' ? { passoutYear: elig.passout_year } : {}),
    workAuthorizations: facts.workAuthorizations,
    ...(facts.eligibility ? { eligibility: facts.eligibility as never } : {}),
  };
  const bank: AnswerBankEntry[] = facts.bank.map((b) => ({ questionKey: b.questionKey, answer: b.answer, source: b.source }));
  const resumeFacts: ResumeFacts = { confirmed: facts.resumeConfirmed, skills: facts.skills, projects: [], experience: [], links: [] };
  const set = answerFrom(profile, bank, resumeFacts, { name: app.companyName, about: '', role: app.jobTitle }, {
    ...(facts.countries.length === 1 ? { country: facts.countries[0]! } : {}),
    campusRule: asCgpaRule(facts.campusRule),
  });
  return {
    resolve(q) {
      const a = answerQuestion(q.label, q.options, set);
      if (a.key === 'unknown') {
        // A question no rule recognises is answered once by the student under a key derived from its wording. Never guessed.
        const key = bankKeyForLabel(q.label);
        // Prose written for one company (cover letter, "why us", "anything else") is never reused for another in auto mode.
        if (PER_APPLICATION.test(q.label)) return { key, status: 'needs_you', value: null, evidence: [], reason: 'Write this for each company yourself' };
        const hit = bank.find((b) => b.questionKey === key);
        const value = hit?.answer.trim();
        return value
          ? { key, status: 'filled', value, evidence: [{ source: 'answer_bank', field: key }] }
          : { key, status: 'needs_you', value: null, evidence: [], reason: 'Answer this once and it is reused for every form that asks it' };
      }
      return { key: a.key, status: a.status, value: a.value, evidence: a.evidence.map((e) => ({ source: e.source, field: e.field })), ...(a.reason ? { reason: a.reason } : {}) };
    },
  };
}

const PER_APPLICATION =
  /cover letter|anything else|why (?:do you|are you|would you|us\b|this|our|should)|why .{0,40}(?:company|role|position|join|apply|work here)|message to|note to (?:the )?(?:hiring|recruit)|tell us about|motivation|statement of purpose|\bsop\b/i;

const extOf = (mime: string): string => (mime === 'application/pdf' ? 'pdf' : 'docx');

export function toFinish(o: SubmitOutcome): FinishWrite {
  const answers: AnswerRowWrite[] = o.answers.map((a) => ({
    fieldId: a.fieldId,
    label: a.label,
    questionKey: a.key,
    required: a.required,
    needsYou: a.needsYou,
    reason: a.reason,
    answer: a.value,
    evidence: a.evidence,
  }));
  return {
    state: o.state,
    reason: o.state === 'submitted' ? null : o.code,
    fallbackNote: o.state === 'blocked_fallback' ? o.message : null,
    answers,
    receipt: {
      answersHash: o.receipt.answersHash,
      resumeId: o.receipt.resumeId,
      resumeVersion: o.receipt.resumeVersion,
      platform: o.receipt.platform,
      resultCode: o.receipt.resultCode,
      sent: o.receipt.sent,
      httpStatus: o.receipt.httpStatus,
    },
  };
}

/** The record of an outcome whose answers could not be stored: no answer rows, the receipt exactly as the executor made it. */
export function unrecordedFinish(o: SubmitOutcome): FinishWrite {
  const w = toFinish(o);
  return {
    ...w,
    answers: [],
    receipt: { ...w.receipt, resultCode: o.state === 'submitted' ? 'accepted_unrecorded' : w.receipt.resultCode },
  };
}

function failedFinish(app: ClaimedApplication): FinishWrite {
  return {
    state: 'failed',
    reason: 'internal_error',
    fallbackNote: null,
    answers: [],
    receipt: {
      answersHash: createHash('sha256').update(`${app.id}\n[]`).digest('hex'),
      resumeId: null,
      resumeVersion: null,
      platform: app.platform,
      resultCode: 'internal_error',
      sent: false,
      httpStatus: null,
    },
  };
}

export async function submitApplication(id: string, deps: SubmitDeps, helpers: Helpers): Promise<'submitted' | 'blocked_fallback' | 'failed' | 'noop' | 'rescheduled'> {
  const claim = await deps.repo.claim(id);
  if (claim.kind === 'gone') {
    helpers.logger.info(`apply:submit ${id} noop`);
    return 'noop';
  }
  if (claim.kind === 'too_early') {
    await helpers.addJob('apply:submit', { applicationId: id }, { jobKey: submitJobKey(id), runAt: new Date(claim.undoUntil.getTime() + RETRY_AFTER_WINDOW_MS) });
    helpers.logger.info(`apply:submit ${id} rescheduled`);
    return 'rescheduled';
  }
  const app = claim.app;
  // Over today's cap: keep the swipe and try again from the student's next local midnight, rather than losing it.
  if (app.attemptsToday > app.dailyCap) {
    const runAt = await deps.repo.requeueForTomorrow(app);
    await helpers.addJob('apply:submit', { applicationId: id }, { jobKey: submitJobKey(id), runAt });
    helpers.logger.info(`apply:submit ${id} over daily cap, rescheduled`);
    return 'rescheduled';
  }
  let outcome: SubmitOutcome | null = null;
  try {
    const facts = await deps.repo.studentFacts(app);
    let blob: ResumeFile | null | undefined;
    const ports: SubmitPorts = {
      gate: {
        hasConsent: async () => facts.autoApply,
        underDailyCap: async () => app.attemptsToday <= app.dailyCap,
        platformEnabled: (p) => deps.repo.platformEnabled(p),
        // Purpose limitation (DPDP): the consent covers the resume, not Aadhaar, PAN, DOB, caste, religion or a photo inside it.
        resumeCleared: async () => facts.sensitiveKinds.length === 0,
      },
      answers: answerPortFor(facts, app),
      transport: deps.transport,
      resume: async () => {
        if (blob === undefined) {
          const r = await deps.repo.loadResume(app);
          blob = r ? { id: r.id, version: r.version, filename: `resume.${extOf(r.mime)}`, mime: r.mime, bytes: r.bytes } : null;
        }
        return blob;
      },
      now: deps.now,
    };
    outcome = await runSubmit({ applicationId: app.id, platform: app.platform, applyUrl: app.applyUrl }, ports);
    await deps.repo.finish(app, toFinish(outcome));
  } catch {
    // Never leave an application in "submitting". If the executor already produced an outcome (in particular, if the request
    // carrying the answers LEFT the process) the record must say what really happened, so it is written from that outcome:
    // sent:true and the status the employer returned, never "internal_error / not sent". Only with no outcome is it a plain failure.
    helpers.logger.error(`apply:submit ${app.id} internal error`);
    const o = outcome as SubmitOutcome | null;
    if (o?.receipt.sent) helpers.logger.error(`apply:submit ${app.id} finished after send failed`);
    try {
      await deps.repo.finish(app, o ? unrecordedFinish(o) : failedFinish(app));
    } catch {
      await deps.repo.failStuck(app.id).catch(() => undefined);
    }
    return o ? o.state : 'failed';
  }
  helpers.logger.info(`apply:submit ${app.id} ${outcome.state} ${outcome.code}`);
  return outcome.state;
}

export async function sweepApplications(deps: SubmitDeps, helpers: Helpers): Promise<{ requeued: number; failed: number }> {
  const { lostReady, stuck } = await deps.repo.sweepable(deps.now());
  for (const id of lostReady) await helpers.addJob('apply:submit', { applicationId: id }, { jobKey: submitJobKey(id) });
  let failed = 0;
  for (const id of stuck) if (await deps.repo.failStuck(id)) failed++;
  helpers.logger.info(`apply:sweep requeued ${lostReady.length} failed ${failed}`);
  return { requeued: lostReady.length, failed };
}

export function createApplyTasks(over: Partial<SubmitDeps> = {}): TaskList {
  let repo: ApplyRepo | undefined;
  const deps = (): SubmitDeps => ({
    repo: over.repo ?? (repo ??= createApplyRepo()),
    transport: over.transport ?? defaultTransport(),
    now: over.now ?? (() => new Date()),
  });
  const submit: Task = async (payload, helpers) => {
    // Global switch: with auto-apply off the worker leaves ready applications alone (nothing is claimed, nothing is sent).
    if (applyMode() === 'off') {
      helpers.logger.info('apply:submit skipped, HIRELANE_AUTO_APPLY=off');
      return;
    }
    await submitApplication(parseApplyPayload(payload), deps(), helpers as unknown as Helpers);
  };
  const sweep: Task = async (_payload, helpers) => {
    if (applyMode() === 'off') return;
    await sweepApplications(deps(), helpers as unknown as Helpers);
  };
  return { 'apply:submit': submit, 'apply:sweep': sweep };
}
