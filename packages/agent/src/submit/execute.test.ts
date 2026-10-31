import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyHostAllowed, DEFAULT_ALLOWED_HOSTS } from './allowlist';
import { runSubmit } from './execute';
import { createFixtureTransport, defaultTransport, guardTransport, isFixtureUrl } from './transport';
import type { AnswerPort, GatePort, HttpRequest, HttpResponse, Platform, QuestionAsked, ResolvedAnswer, ResumeFile, SubmitJob, SubmitPorts, Transport } from './types';
import { TransportRefused } from './types';

const fx = (n: string): string => readFileSync(join(import.meta.dirname, 'fixtures', n), 'utf8');
const NOW = new Date('2026-10-29T10:00:00Z');
const RESUME: ResumeFile = { id: '11111111-1111-4111-8111-111111111111', version: 3, filename: 'asha-resume.pdf', mime: 'application/pdf', bytes: new TextEncoder().encode('%PDF-1.4 synthetic') };

/** Answers keyed by a word in the label. Everything else is Needs-you. Synthetic student. */
const KNOWN: Record<string, string> = {
  'full name': 'Asha Kulkarni',
  email: 'asha@example.test',
  phone: '+91 90000 00000',
  name: 'Asha Kulkarni',
  'notice period': '30 days',
  graduation: '2026',
  linkedin: 'https://www.linkedin.com/in/asha-example',
  authorized: 'Yes',
  relocate: 'Yes',
  'additional information': 'Available to start in July 2026.',
};
function answers(extra: Record<string, string> = {}, drop: string[] = []): AnswerPort {
  const table = { ...KNOWN, ...extra };
  for (const d of drop) delete table[d];
  return {
    resolve(q: QuestionAsked): ResolvedAnswer {
      const l = q.label.toLowerCase();
      const hit = Object.keys(table).find((k) => l.includes(k));
      return hit
        ? { key: hit, status: 'filled', value: table[hit]!, evidence: [{ source: 'profile', field: hit }] }
        : { key: 'unknown', status: 'needs_you', value: null, evidence: [], reason: 'not_in_answer_bank' };
    },
  };
}
const openGate = (over: Partial<GatePort> = {}): GatePort => ({ hasConsent: async () => true, underDailyCap: async () => true, platformEnabled: async () => true, ...over });

class Recorder implements Transport {
  sent: HttpRequest[] = [];
  constructor(private inner: Transport = createFixtureTransport()) {}
  send(req: HttpRequest): Promise<HttpResponse> {
    this.sent.push(req);
    return this.inner.send(req);
  }
}
const url = (platform: Platform, scenario = 'ok'): string => `https://${platform}.fixture.invalid/${scenario}/job-1`;
const job = (platform: Platform, scenario = 'ok'): SubmitJob => ({ applicationId: '22222222-2222-4222-8222-222222222222', platform, applyUrl: url(platform, scenario) });
const ports = (over: Partial<SubmitPorts> = {}): SubmitPorts => ({ gate: openGate(), answers: answers(), transport: new Recorder(), resume: async () => RESUME, now: () => NOW, ...over });

afterEach(() => vi.restoreAllMocks());

describe('sensitive resume clearance', () => {
  it('a resume that holds sensitive items is never sent: "finish on their site", no request', async () => {
    const rec = new Recorder();
    const o = await runSubmit(job('greenhouse'), ports({ transport: rec, gate: openGate({ resumeCleared: async () => false }) }));
    expect(o).toMatchObject({ state: 'blocked_fallback', code: 'sensitive_resume' });
    expect(o.receipt.sent).toBe(false);
    expect(rec.sent).toHaveLength(0);
  });
  it('a cleared resume proceeds', async () => {
    const o = await runSubmit(job('greenhouse'), ports({ gate: openGate({ resumeCleared: async () => true }) }));
    expect(o.state).toBe('submitted');
  });
});

describe('run order: consent, cap, kill switch come first', () => {
  it.each([
    ['no_consent', { hasConsent: async () => false }, ['consent']],
    ['daily_cap', { underDailyCap: async () => false }, ['consent', 'cap']],
    ['platform_paused', { platformEnabled: async () => false }, ['consent', 'cap', 'kill_switch']],
  ] as const)('%s blocks before any request, with "finish on their site"', async (code, gate, steps) => {
    const t = new Recorder();
    const out = await runSubmit(job('greenhouse'), ports({ gate: openGate(gate), transport: t }));
    expect(out).toMatchObject({ state: 'blocked_fallback', code, message: 'finish on their site' });
    expect(out.steps).toEqual(steps);
    expect(t.sent).toEqual([]);
    expect(out.receipt).toMatchObject({ sent: false, resultCode: code, platform: 'greenhouse' });
  });

  it('asks the kill switch about this job\'s platform', async () => {
    const asked: Platform[] = [];
    await runSubmit(job('ashby'), ports({ gate: openGate({ platformEnabled: async (p) => (asked.push(p), false) }) }));
    expect(asked).toEqual(['ashby']);
  });
});

describe.each([['greenhouse'], ['lever'], ['ashby']] as const)('%s end to end against the fixture employer', (platform) => {
  it('builds the answers, submits and records a receipt', async () => {
    const t = new Recorder();
    const out = await runSubmit(job(platform), ports({ transport: t }));
    expect(out.state).toBe('submitted');
    expect(out.code).toBe('accepted');
    expect(out.message).toBeNull();
    expect(out.steps).toEqual(['consent', 'cap', 'kill_switch', 'form', 'answers', 'submit']);
    expect(out.answers.every((a) => !a.needsYou && a.evidence.length > 0)).toBe(true);
    expect(out.receipt).toMatchObject({ sent: true, httpStatus: 200, resultCode: 'accepted', resumeId: RESUME.id, resumeVersion: 3, platform });
    expect(out.receipt.answersHash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.receipt.at).toEqual(NOW);
    expect(t.sent.map((r) => r.method)).toEqual(['GET', 'POST']);
    const post = t.sent[1]!;
    expect(post.url).toBe(`${url(platform)}/submit`);
    const body = Buffer.from(post.body as Uint8Array).toString('utf8');
    expect(body).toContain('Asha Kulkarni'.split(' ')[0]);
    expect(body).toContain('filename="asha-resume.pdf"');
    expect(body).toContain('%PDF-1.4 synthetic');
  });

  it('is deterministic: the same answers give the same hash, other answers another', async () => {
    const a = await runSubmit(job(platform), ports());
    const b = await runSubmit(job(platform), ports());
    const c = await runSubmit(job(platform), ports({ answers: answers({ 'notice period': 'Immediately' }) }));
    expect(a.receipt.answersHash).toBe(b.receipt.answersHash);
    expect(c.receipt.answersHash).not.toBe(a.receipt.answersHash);
  });
});

describe('field mapping details', () => {
  it('splits a full name for first and last name boxes and maps Yes/No onto the form\'s own option values', async () => {
    const t = new Recorder();
    await runSubmit(job('greenhouse'), ports({ transport: t }));
    const body = Buffer.from(t.sent[1]!.body as Uint8Array).toString('utf8');
    expect(body).toMatch(/name="first_name"\r\n\r\nAsha\r\n/);
    expect(body).toMatch(/name="last_name"\r\n\r\nKulkarni\r\n/);
    expect(body).toMatch(/name="question_1003"\r\n\r\n1\r\n/);
    expect(body).toMatch(/name="question_1002"\r\n\r\n30 days\r\n/);
  });

  it('never submits the voluntary self-identification section', async () => {
    const t = new Recorder();
    await runSubmit(job('greenhouse'), ports({ transport: t }));
    expect(Buffer.from(t.sent[1]!.body as Uint8Array).toString('utf8')).not.toContain('name="gender"');
  });
});

describe('Needs-you blocks the submission', () => {
  it('an unanswered question stops the run before submit and lists what the student must answer', async () => {
    const t = new Recorder();
    const out = await runSubmit(job('greenhouse'), ports({ transport: t, answers: answers({}, ['notice period']) }));
    expect(out).toMatchObject({ state: 'blocked_fallback', code: 'needs_you', message: 'finish on their site' });
    expect(out.steps).not.toContain('submit');
    expect(t.sent.map((r) => r.method)).toEqual(['GET']);
    const need = out.answers.filter((a) => a.needsYou);
    expect(need).toHaveLength(1);
    expect(need[0]).toMatchObject({ label: 'What is your notice period?', required: true, value: null, evidence: [], reason: 'not_in_answer_bank' });
    expect(out.receipt).toMatchObject({ sent: false, resultCode: 'needs_you' });
  });

  it('by default an unanswered OPTIONAL question blocks too (the owner\'s rule); blockOn "required" lets it through blank', async () => {
    const drop = ['linkedin']; // optional LinkedIn question
    const strict = await runSubmit(job('greenhouse'), ports({ answers: answers({}, drop) }));
    expect(strict).toMatchObject({ state: 'blocked_fallback', code: 'needs_you' });
    const lax = await runSubmit(job('greenhouse'), ports({ answers: answers({}, drop) }), { blockOn: 'required' });
    expect(lax.state).toBe('submitted');
    expect(lax.answers.find((a) => a.needsYou)?.required).toBe(false);
  });

  it('an answer with no evidence is not an answer', async () => {
    const liar: AnswerPort = { resolve: (q) => ({ key: 'x', status: 'filled', value: 'something plausible', evidence: [] }) };
    const out = await runSubmit(job('ashby'), ports({ answers: liar }));
    expect(out).toMatchObject({ state: 'blocked_fallback', code: 'needs_you' });
    expect(out.answers.every((a) => a.needsYou && a.reason === 'no_evidence')).toBe(true);
  });

  it('an answer that is not one of the form\'s options is not guessed onto one', async () => {
    const out = await runSubmit(job('ashby'), ports({ answers: answers({ 'notice period': 'Whenever' }) }));
    expect(out).toMatchObject({ state: 'blocked_fallback', code: 'needs_you' });
    expect(out.answers.find((a) => a.fieldId === 'notice_field')).toMatchObject({ needsYou: true, reason: 'no_matching_option' });
  });

  it('a missing resume on a required resume field is a Needs-you', async () => {
    const out = await runSubmit(job('lever'), ports({ resume: async () => null }));
    expect(out).toMatchObject({ code: 'needs_you' });
    expect(out.answers.find((a) => a.fieldId === 'resume')).toMatchObject({ needsYou: true, reason: 'resume_missing' });
  });

  it('an invalid email or number is not sent', async () => {
    const out = await runSubmit(job('ashby'), ports({ answers: answers({ email: 'not-an-email', graduation: 'twenty twenty six' }) }));
    expect(out.answers.filter((a) => a.needsYou).map((a) => a.reason).sort()).toEqual(['invalid_email', 'invalid_number']);
  });
});

describe('CAPTCHA, bot-check and login walls end the attempt', () => {
  it.each([
    ['greenhouse', 'captcha', 'captcha'],
    ['lever', 'captcha', 'captcha'],
    ['ashby', 'captcha', 'captcha'],
    ['lever', 'login', 'login'],
    ['ashby', 'login', 'login'],
  ] as const)('%s form with a %s wall becomes blocked_fallback (%s)', async (platform, scenario, code) => {
    const t = new Recorder();
    const out = await runSubmit(job(platform, scenario), ports({ transport: t }));
    expect(out).toMatchObject({ state: 'blocked_fallback', code, message: 'finish on their site' });
    expect(t.sent.map((r) => r.method)).toEqual(['GET']);
    expect(out.receipt.sent).toBe(false);
  });

  it.each(['greenhouse', 'lever', 'ashby'] as const)('%s: a CAPTCHA that appears only on submit is honoured, and the receipt says a request was sent', async (platform) => {
    const out = await runSubmit(job(platform, 'captcha-submit'), ports());
    expect(out).toMatchObject({ state: 'blocked_fallback', code: 'captcha', message: 'finish on their site' });
    expect(out.receipt).toMatchObject({ sent: true, httpStatus: 403, resultCode: 'captcha' });
  });

  it('recognises bot-check pages and login redirects in any reply', async () => {
    const reply = (res: Partial<HttpResponse>): Transport => ({ send: async () => ({ status: 200, headers: {}, body: '', ...res }) });
    const cf = await runSubmit(job('lever'), ports({ transport: reply({ status: 403, body: '<title>Just a moment...</title><div id="cf-challenge-running">' }) }));
    expect(cf).toMatchObject({ state: 'blocked_fallback', code: 'challenge' });
    const redirect = await runSubmit(job('lever'), ports({ transport: reply({ status: 302, headers: { location: 'https://x.fixture.invalid/login?next=/apply' } }) }));
    expect(redirect).toMatchObject({ state: 'blocked_fallback', code: 'login' });
    const unauth = await runSubmit(job('ashby'), ports({ transport: reply({ status: 401, body: '{}' }) }));
    expect(unauth).toMatchObject({ state: 'blocked_fallback', code: 'login' });
  });

  it('does not retry, wait or solve: one GET and nothing else', async () => {
    const t = new Recorder();
    await runSubmit(job('greenhouse', 'captcha'), ports({ transport: t }));
    expect(t.sent).toHaveLength(1);
  });
});

describe('failures', () => {
  it('a rejected application is failed with the status, not blocked', async () => {
    const out = await runSubmit(job('greenhouse', 'reject'), ports());
    expect(out).toMatchObject({ state: 'failed', code: 'http_422', message: null });
    expect(out.receipt).toMatchObject({ sent: true, httpStatus: 422 });
  });
  it('a missing form is failed', async () => {
    expect(await runSubmit(job('ashby', 'missing'), ports())).toMatchObject({ state: 'failed', code: 'form_not_found' });
  });
  it('a form it cannot read is "finish on their site", not a guess', async () => {
    const odd: Transport = { send: async () => ({ status: 200, headers: {}, body: '{"something":"else"}' }) };
    expect(await runSubmit(job('greenhouse'), ports({ transport: odd }))).toMatchObject({ state: 'blocked_fallback', code: 'unsupported_form' });
  });
  it('a network error is failed and assumed to have reached the server only when it happened on submit', async () => {
    let n = 0;
    const flaky: Transport = {
      send: async (r) => {
        if (r.method === 'GET') return createFixtureTransport().send(r);
        n++;
        throw new Error('socket hang up');
      },
    };
    const out = await runSubmit(job('greenhouse'), ports({ transport: flaky }));
    expect(n).toBe(1);
    expect(out).toMatchObject({ state: 'failed', code: 'transport_error', receipt: { sent: true } });
    const down: Transport = { send: async () => { throw new Error('ECONNRESET'); } };
    expect(await runSubmit(job('greenhouse'), ports({ transport: down }))).toMatchObject({ state: 'failed', code: 'transport_error', receipt: { sent: false } });
  });
});

describe('the default transport refuses everything that is not a fixture host', () => {
  const REAL = ['https://boards.example.com/acme/jobs/1', 'http://greenhouse.fixture.invalid/ok/1', 'https://fixture.invalid/ok/1', 'https://evil.com/x.fixture.invalid', 'https://x.fixture.invalid.evil.com/', 'https://user:pw@a.fixture.invalid/', 'not a url', '', 'ftp://a.fixture.invalid/'];
  it.each(REAL)('refuses %s', async (u) => {
    expect(isFixtureUrl(u)).toBe(false);
    await expect(defaultTransport().send({ method: 'GET', url: u })).rejects.toBeInstanceOf(TransportRefused);
  });
  it('accepts fixture hosts, in any case', () => {
    expect(isFixtureUrl('https://greenhouse.fixture.invalid/ok/1')).toBe(true);
    expect(isFixtureUrl('https://LEVER.Fixture.Invalid/ok/1')).toBe(true);
  });
  it('a live-looking apply URL ends as "finish on their site" with no request made, and fetch is never called', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    // The host is put on the allowlist here on purpose, so this test still proves the SECOND door (the transport guard) holds.
    const out = await runSubmit({ applicationId: '33333333-3333-4333-8333-333333333333', platform: 'greenhouse', applyUrl: 'https://boards.example.com/acme/jobs/1' }, ports({ transport: defaultTransport() }), { allowedHosts: ['boards.example.com'] });
    expect(out).toMatchObject({ state: 'blocked_fallback', code: 'live_disabled', message: 'finish on their site', receipt: { sent: false } });
    expect(spy).not.toHaveBeenCalled();
  });
  it('a whole fixture run through the default transport never touches fetch', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const out = await runSubmit(job('lever'), ports({ transport: defaultTransport() }));
    expect(out.state).toBe('submitted');
    expect(spy).not.toHaveBeenCalled();
  });
  it('guardTransport never calls the inner transport for a refused host', async () => {
    const inner = { send: vi.fn() };
    await expect(guardTransport(inner).send({ method: 'POST', url: 'https://api.example.com/apply' })).rejects.toBeInstanceOf(TransportRefused);
    expect(inner.send).not.toHaveBeenCalled();
  });
});

describe('the module has no network of its own and no dependency on anything that could add one', () => {
  const files = ['execute.ts', 'challenge.ts', 'transport.ts', 'payload.ts', 'types.ts', 'html.ts', 'forms/common.ts', 'forms/lever.ts', 'forms/ashby.ts', 'forms/greenhouse.ts', 'forms/index.ts', 'index.ts', 'allowlist.ts'];
  const src = files.map((n) => readFileSync(join(import.meta.dirname, n), 'utf8')).join('\n');
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
  it('imports only its own files and three node builtins (crypto, fs, path)', () => {
    for (const i of imports) expect(i.startsWith('./') || i.startsWith('../') || ['node:crypto', 'node:fs', 'node:path'].includes(i), i).toBe(true);
  });
  it('never calls fetch or opens a socket (the transport is the only door)', () => {
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|node:(https?|net|tls|dns|http2)|undici|WebSocket/);
  });
  it('has no hook for an LLM, a browser or a solver service', () => {
    expect(src).not.toMatch(/@anthropic-ai|openai|puppeteer|playwright|2captcha|anticaptcha|capsolver|setTimeout|setInterval/i);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Pilot blocker 1 (docs/apply.md "Open before pilot" item 1): prose the engine composed is NEVER sent unseen.
// ---------------------------------------------------------------------------------------------------------------------------
describe('composed free text is never auto-submitted; it comes back as a draft the student must confirm', () => {
  const DRAFT = 'I am applying for the Engineer role at Acme. It fits my Intern experience at Beta, and I want to build on it.';
  /** The lever fixture asks "Additional information". `evidence` decides whether the engine wrote it or the student did. */
  const prose = (key: string, evidence: { source: string; field: string }[]): AnswerPort => ({
    resolve(q) {
      if (q.label.toLowerCase().includes('additional information')) return { key, status: 'filled', value: DRAFT, evidence };
      return answers().resolve(q);
    },
  });
  const TEMPLATE_EVIDENCE = [{ source: 'company', field: 'name' }, { source: 'resume', field: 'experience' }];

  it.each(['why_role', 'about_yourself', 'why_company'])('%s from a template blocks as needs_you, keeps the draft as a suggestion, and sends nothing', async (key) => {
    const t = new Recorder();
    const out = await runSubmit(job('lever'), ports({ transport: t, answers: prose(key, TEMPLATE_EVIDENCE) }));
    expect(out).toMatchObject({ state: 'blocked_fallback', code: 'needs_you', message: 'finish on their site', receipt: { sent: false } });
    expect(t.sent.map((r) => r.method)).toEqual(['GET']);
    expect(out.steps).not.toContain('submit');
    const a = out.answers.find((x) => x.key === key)!;
    expect(a).toMatchObject({ needsYou: true, reason: 'confirm_draft', value: null, suggestion: DRAFT });
    // the draft is not in the receipt hash input: nothing was composed into the submission
    expect(out.receipt.answersHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a template answer blocks the submission as a whole', async () => {
    const out = await runSubmit(job('lever'), ports({ answers: prose('why_role', TEMPLATE_EVIDENCE) }));
    expect(out.state).toBe('blocked_fallback');
  });

  it('prose the engine composed under any key is held when its evidence is the company line', async () => {
    const out = await runSubmit(job('lever'), ports({ answers: prose('unknown', [{ source: 'company', field: 'about' }]) }));
    expect(out.answers.find((a) => a.suggestion === DRAFT)).toMatchObject({ needsYou: true, reason: 'confirm_draft' });
    expect(out.state).toBe('blocked_fallback');
  });

  it('the student\'s own saved answer for the same key IS sent', async () => {
    const t = new Recorder();
    const out = await runSubmit(job('lever'), ports({ transport: t, answers: prose('why_role', [{ source: 'answer_bank', field: 'why_role' }]) }));
    expect(out.state).toBe('submitted');
    expect(Buffer.from(t.sent[1]!.body as Uint8Array).toString('utf8')).toContain(DRAFT);
  });

  it('structured facts still auto-fill (name, email, notice period, graduation year)', async () => {
    const out = await runSubmit(job('greenhouse'), ports());
    expect(out.state).toBe('submitted');
    expect(out.answers.every((a) => !a.needsYou && a.suggestion == null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Pilot blocker 2: the apply-host allowlist, checked by the executor before any transport call.
// ---------------------------------------------------------------------------------------------------------------------------
describe('apply-host allowlist', () => {
  it('the default list is the fixture suffix only', () => {
    expect(DEFAULT_ALLOWED_HOSTS).toEqual(['*.fixture.invalid']);
  });
  it.each([
    ['https://greenhouse.fixture.invalid/ok/1', true],
    ['https://LEVER.Fixture.Invalid/ok/1', true],
    ['https://boards.example.com/acme/1', false],
    ['http://greenhouse.fixture.invalid/ok/1', false],
    ['https://user:pw@a.fixture.invalid/', false],
    ['https://fixture.invalid/', false],
    ['https://a.fixture.invalid.evil.com/', false],
    ['https://evil.com/a.fixture.invalid', false],
    ['https://127.0.0.1/', false],
    ['not a url', false],
    ['', false],
  ])('%s -> %s', (u, ok) => {
    expect(applyHostAllowed(u)).toBe(ok);
  });
  it('exact hosts and wildcard suffixes both work; a wildcard never matches the bare domain', () => {
    expect(applyHostAllowed('https://boards.example.com/x', ['boards.example.com'])).toBe(true);
    expect(applyHostAllowed('https://api.boards.example.com/x', ['boards.example.com'])).toBe(false);
    expect(applyHostAllowed('https://a.example.com/x', ['*.example.com'])).toBe(true);
    expect(applyHostAllowed('https://example.com/x', ['*.example.com'])).toBe(false);
    expect(applyHostAllowed('https://a.example.com/x', [])).toBe(false);
  });
  it('a host off the list ends as "finish on their site" and the transport is never called', async () => {
    const t = new Recorder();
    const out = await runSubmit({ applicationId: '33333333-3333-4333-8333-333333333333', platform: 'greenhouse', applyUrl: 'https://boards.example.com/acme/jobs/1' }, ports({ transport: t }));
    expect(out).toMatchObject({ state: 'blocked_fallback', code: 'host_not_allowed', message: 'finish on their site', receipt: { sent: false } });
    expect(t.sent).toEqual([]);
  });
  it('a malformed apply URL is blocked the same way', async () => {
    const t = new Recorder();
    const out = await runSubmit({ applicationId: '33333333-3333-4333-8333-333333333333', platform: 'lever', applyUrl: 'javascript:alert(1)' }, ports({ transport: t }));
    expect(out).toMatchObject({ state: 'blocked_fallback', code: 'host_not_allowed' });
    expect(t.sent).toEqual([]);
  });
  it('consent and the cap are still checked first (the allowlist adds a door, it does not move the others)', async () => {
    const out = await runSubmit({ applicationId: '33333333-3333-4333-8333-333333333333', platform: 'lever', applyUrl: 'https://x.example.com/' }, ports({ gate: openGate({ hasConsent: async () => false }) }));
    expect(out.code).toBe('no_consent');
  });
  it('a custom allowlist lets only its hosts through to the transport', async () => {
    const t = new Recorder({ send: async () => ({ status: 404, headers: {}, body: 'nope' }) });
    const out = await runSubmit({ applicationId: '33333333-3333-4333-8333-333333333333', platform: 'greenhouse', applyUrl: 'https://boards.example.com/acme/jobs/1' }, ports({ transport: t }), { allowedHosts: ['boards.example.com'] });
    expect(out.code).toBe('form_not_found');
    expect(t.sent).toHaveLength(1);
  });
});
