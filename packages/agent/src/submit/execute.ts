import { createHash } from 'node:crypto';
import { detectBlock } from './challenge';
import { readFormSpec } from './forms';
import { buildMultipart } from './payload';
import {
  FormParseError,
  TransportRefused,
  type BlockKind,
  type BuiltAnswer,
  type FormField,
  type FormSpec,
  type HttpResponse,
  type OutcomeState,
  type ReceiptData,
  type ResumeFile,
  type SubmitJob,
  type SubmitOptions,
  type SubmitOutcome,
  type SubmitPorts,
} from './types';

const MAX_FORM_BYTES = 2_000_000;
const norm = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

interface Built {
  answers: BuiltAnswer[];
  pairs: [string, string][];
  resumeField: string | null;
  resume: ResumeFile | null;
}

const needs = (f: FormField, reason: string, key = 'unknown'): BuiltAnswer => ({ fieldId: f.id, label: f.label, required: f.required, key, needsYou: true, reason, value: null, evidence: [] });

/** The part of a full name a first-name or last-name box wants, or null for any other field. */
function namePart(f: FormField): 'first' | 'last' | null {
  const l = norm(f.label);
  if (/^(first|given) name$/.test(l) || /^first_?name$/.test(f.id)) return 'first';
  if (/^(last|family) name$/.test(l) || /^surname$/.test(l) || /^last_?name$/.test(f.id)) return 'last';
  return null;
}

/** Maps an answer onto one of the field's own options. Never guesses: no match means the student must answer. */
function matchOption(f: FormField, value: string): string[] | null {
  const wanted = (f.kind === 'multiselect' ? value.split(',') : [value]).map(norm).filter(Boolean);
  if (wanted.length === 0) return null;
  const out: string[] = [];
  for (const w of wanted) {
    const hit = (f.options ?? []).find((o) => norm(o.label) === w || norm(o.value) === w);
    if (!hit) return null;
    out.push(hit.value);
  }
  return out;
}

async function buildAnswers(spec: FormSpec, ports: SubmitPorts): Promise<Built> {
  const answers: BuiltAnswer[] = [];
  const pairs: [string, string][] = [];
  let resumeField: string | null = null;
  let resume: ResumeFile | null | undefined;
  for (const f of spec.fields) {
    if (f.kind === 'captcha') continue;
    if (f.kind === 'file') {
      if (f.fileRole === 'resume') {
        resume ??= await ports.resume();
        if (resume) resumeField = f.id;
        else if (f.required) answers.push(needs(f, 'resume_missing', 'resume'));
      } else if (f.required) {
        answers.push(needs(f, 'file_not_available', 'file'));
      }
      continue;
    }
    const part = namePart(f);
    const asked = await ports.answers.resolve({
      label: part ? 'Full name' : f.label,
      kind: f.kind,
      ...(f.options ? { options: f.options.map((o) => o.label) } : {}),
    });
    const raw = asked.value?.replace(/\s+/g, ' ').trim() ?? '';
    // Nothing invented: an answer needs a value AND evidence, or it is the student's to give.
    if (asked.status !== 'filled' || !raw || asked.evidence.length === 0) {
      answers.push(needs(f, asked.status === 'filled' ? 'no_evidence' : (asked.reason ?? 'needs_you'), asked.key));
      continue;
    }
    let values: string[] | null;
    let shown = raw;
    if (part) {
      const words = raw.split(' ');
      shown = part === 'first' ? words[0]! : words.slice(1).join(' ');
      values = shown ? [shown] : null;
    } else if (f.kind === 'select' || f.kind === 'multiselect' || (f.kind === 'boolean' && f.options?.length)) {
      values = matchOption(f, raw);
    } else if (f.kind === 'boolean') {
      const n = norm(raw);
      values = /^(yes|y|true|1)$/.test(n) ? ['true'] : /^(no|n|false|0)$/.test(n) ? ['false'] : null;
    } else if (f.kind === 'email') {
      values = EMAIL.test(raw) ? [raw] : null;
    } else if (f.kind === 'number') {
      values = NUMBER.test(raw) ? [raw] : null;
    } else {
      values = [raw];
    }
    if (!values) {
      answers.push(needs(f, part ? 'name_has_one_word' : f.kind === 'email' || f.kind === 'number' ? `invalid_${f.kind}` : 'no_matching_option', asked.key));
      continue;
    }
    answers.push({ fieldId: f.id, label: f.label, required: f.required, key: asked.key, needsYou: false, reason: null, value: shown, evidence: asked.evidence });
    for (const v of values) pairs.push([f.id, v]);
  }
  return { answers, pairs, resumeField, resume: resumeField ? (resume ?? null) : null };
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const hashAnswers = (applicationId: string, pairs: [string, string][]): string =>
  sha(`${applicationId}\n${JSON.stringify([...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)))}`);

/**
 * Runs one submission. In order:
 *   1. consent, daily cap, platform kill switch (each failure is "finish on their site")
 *   2. read the form (a CAPTCHA, bot-check or login wall ends the attempt here: no solving, no evasion, no account creation)
 *   3. build the answers from evidence; any unanswered Needs-you blocks the submission
 *   4. submit through the injected transport (the default one refuses every non-fixture host); a block marker in the reply ends it
 *   5. return the receipt for the caller to store
 * Never throws for an expected outcome. 0 LLM calls.
 */
export async function runSubmit(job: SubmitJob, ports: SubmitPorts, opts: SubmitOptions = {}): Promise<SubmitOutcome> {
  const steps: string[] = [];
  const blockOn = opts.blockOn ?? 'all';
  let built: Built = { answers: [], pairs: [], resumeField: null, resume: null };
  let resumeUsed: ResumeFile | null = null;

  const done = (state: OutcomeState, code: string, o: { sent?: boolean; httpStatus?: number | null } = {}): SubmitOutcome => {
    const receipt: ReceiptData = {
      answersHash: hashAnswers(job.applicationId, built.pairs),
      resumeId: resumeUsed?.id ?? null,
      resumeVersion: resumeUsed?.version ?? null,
      platform: job.platform,
      resultCode: code,
      sent: o.sent ?? false,
      httpStatus: o.httpStatus ?? null,
      at: ports.now(),
    };
    return { state, code, message: state === 'blocked_fallback' ? 'finish on their site' : null, answers: built.answers, receipt, steps };
  };
  const blocked = (code: string, o: { sent?: boolean; httpStatus?: number | null } = {}) => done('blocked_fallback', code, o);
  const wall = (kind: BlockKind, o: { sent?: boolean; httpStatus?: number | null } = {}) => blocked(kind, o);

  // 1. consent, cap, kill switch
  steps.push('consent');
  if (!(await ports.gate.hasConsent())) return blocked('no_consent');
  steps.push('cap');
  if (!(await ports.gate.underDailyCap())) return blocked('daily_cap');
  steps.push('kill_switch');
  if (!(await ports.gate.platformEnabled(job.platform))) return blocked('platform_paused');

  if (ports.gate.resumeCleared) {
    steps.push('resume_clearance');
    if (!(await ports.gate.resumeCleared())) return blocked('sensitive_resume');
  }

  // 2. the form
  steps.push('form');
  let res: HttpResponse;
  try {
    res = await ports.transport.send({ method: 'GET', url: job.applyUrl, headers: { accept: 'application/json, text/html' } });
  } catch (e) {
    return e instanceof TransportRefused ? blocked('live_disabled') : done('failed', 'transport_error');
  }
  const formBlock = detectBlock(res);
  if (formBlock) return wall(formBlock, { httpStatus: res.status });
  if (res.status === 404 || res.status === 410) return done('failed', 'form_not_found', { httpStatus: res.status });
  if (res.status < 200 || res.status >= 300) return done('failed', `http_${res.status}`, { httpStatus: res.status });
  if (res.body.length > MAX_FORM_BYTES) return blocked('unsupported_form', { httpStatus: res.status });
  let spec: FormSpec;
  try {
    spec = readFormSpec(job.platform, res.body);
  } catch (e) {
    if (e instanceof FormParseError) return blocked('unsupported_form', { httpStatus: res.status });
    throw e;
  }
  if (spec.block) return wall(spec.block, { httpStatus: res.status });

  // 3. the answers
  steps.push('answers');
  built = await buildAnswers(spec, ports);
  const stuck = built.answers.filter((a) => a.needsYou && (blockOn === 'all' || a.required));
  if (stuck.length > 0) return blocked('needs_you');

  // 4. submit
  steps.push('submit');
  const file = built.resume;
  resumeUsed = file;
  const payload = buildMultipart(built.pairs, built.resumeField && file ? { field: built.resumeField, file } : null);
  let sent: HttpResponse;
  try {
    sent = await ports.transport.send({
      method: 'POST',
      url: `${job.applyUrl.replace(/\/+$/, '')}/submit`,
      headers: { 'content-type': payload.contentType, accept: 'application/json' },
      body: payload.body,
    });
  } catch (e) {
    return e instanceof TransportRefused ? blocked('live_disabled') : done('failed', 'transport_error', { sent: true });
  }
  const afterBlock = detectBlock(sent);
  if (afterBlock) return wall(afterBlock, { sent: true, httpStatus: sent.status });
  if (sent.status >= 200 && sent.status < 300) return done('submitted', 'accepted', { sent: true, httpStatus: sent.status });
  if (sent.status === 429) return done('failed', 'rate_limited', { sent: true, httpStatus: sent.status });
  return done('failed', `http_${sent.status}`, { sent: true, httpStatus: sent.status });
}
