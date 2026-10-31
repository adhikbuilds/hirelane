/**
 * answerFrom: fill every known key from confirmed facts, deterministically, with evidence. No LLM, no guessing.
 * A value needs an evidence record or the answer is "Needs you". Gender/EEO and family/ID fields are never filled.
 * Free text (why this company, why this role, about yourself) is a fixed template filled with the company's about
 * line and the student's strongest confirmed evidence (experience, then project, then skills).
 */
import { applyCgpaRule } from '../eligibility/cgpa';
import { fmt1, resolveConversion, round1 } from '../eligibility/evaluate';
import type { CgpaRule } from '../eligibility/types';
import { classifyQuestion } from './classify';
import { ANSWER_KEYS } from './types';
import type { Answer, AnswerBankEntry, AnswerEvidence, AnswerKey, AnswerOptions, AnswerProfile, AnswerSet, CompanyFacts, QuestionKey, ResumeFacts } from './types';

const MAX_BANK_ANSWER = 2000;
const MAX_ABOUT = 300;

const needs = (key: QuestionKey, reason: string): Answer => ({ key, status: 'needs_you', value: null, evidence: [], reason });
const filled = (key: QuestionKey, value: string, evidence: AnswerEvidence[]): Answer => ({ key, status: 'filled', value, evidence });
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.replace(/\s+/g, ' ').trim() : null);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const trimNum = (n: number): string => String(Math.round(n * 100 + 1e-9) / 100);

function host(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return { host: u.hostname.toLowerCase().replace(/^www\./, ''), path: u.pathname };
  } catch {
    return null;
  }
}
const isLinkedin = (u: string): boolean => {
  const h = host(u);
  return !!h && h.host === 'linkedin.com' && /^\/in\/[^/]+/.test(h.path);
};
const isGithub = (u: string): boolean => {
  const h = host(u);
  return !!h && h.host === 'github.com' && /^\/[^/]+/.test(h.path);
};

const SENSITIVE_KEYS = new Set<QuestionKey>(['gender_eeo', 'sensitive_id']);
const BANK_KEYS = new Set<QuestionKey>(['notice_period', 'relocation', 'expected_ctc', 'current_ctc', 'work_authorization', 'visa_sponsorship', 'why_company', 'why_role', 'about_yourself']);

function fromBank(key: AnswerKey, bank: readonly AnswerBankEntry[]): Answer | null {
  if (!BANK_KEYS.has(key)) return null;
  const hit = bank.find((b) => b && b.questionKey === key);
  const v = hit ? str(hit.answer) : null;
  if (!hit || !v || v.length > MAX_BANK_ANSWER) return null;
  return filled(key, v, [{ source: 'answer_bank', field: key, value: v }]);
}

interface Strongest {
  text: string;
  source: AnswerEvidence;
}

function strongest(r: ResumeFacts | null | undefined): Strongest | null {
  if (!r || r.confirmed !== true) return null;
  const exp = (r.experience ?? []).find((e) => str(e?.role) && str(e?.org));
  if (exp) {
    const value = `${str(exp.role)} experience at ${str(exp.org)}`;
    return { text: value, source: { source: 'resume', field: 'experience', value } };
  }
  const proj = (r.projects ?? []).find((p) => str(p?.title));
  if (proj) {
    const value = `project "${str(proj.title)}"`;
    return { text: value, source: { source: 'resume', field: 'projects', value } };
  }
  const skills = (r.skills ?? []).map(str).filter((s): s is string => s !== null).slice(0, 3);
  if (skills.length) {
    const list = skills.length === 1 ? skills[0]! : `${skills.slice(0, -1).join(', ')} and ${skills[skills.length - 1]}`;
    const value = `skills in ${list}`;
    return { text: value, source: { source: 'resume', field: 'skills', value } };
  }
  return null;
}

function about(c: CompanyFacts | null | undefined): string | null {
  const a = str(c?.about);
  if (!a) return null;
  let line = a.replace(/[.\s]+$/, '');
  if (line.length > MAX_ABOUT) line = line.slice(0, MAX_ABOUT).replace(/\s+\S*$/, '');
  return line || null;
}

function templates(key: 'why_company' | 'why_role' | 'about_yourself', profile: AnswerProfile, resume: ResumeFacts, company: CompanyFacts | null): Answer {
  const ev = strongest(resume);
  if (!ev) return needs(key, 'We have no confirmed project, experience or skills to write this from. Confirm your resume or write it yourself');
  if (key === 'about_yourself') {
    const degree = str(profile.degree);
    if (!degree) return needs(key, 'Your degree is missing');
    const evidence: AnswerEvidence[] = [{ source: 'profile', field: 'degree', value: degree }];
    let text = `I am a ${degree} candidate`;
    if (isNum(profile.passoutYear)) {
      const y = String(profile.passoutYear);
      text += ` from the batch of ${y}`;
      evidence.push({ source: 'profile', field: 'passoutYear', value: y });
    }
    text += `. My strongest work is my ${ev.text}.`;
    evidence.push(ev.source);
    return filled(key, text, evidence);
  }
  const name = str(company?.name);
  if (!company || !name) return needs(key, 'We need the company details for this');
  const nameEv: AnswerEvidence = { source: 'company', field: 'name', value: name };
  if (key === 'why_role') {
    const role = str(company.role);
    if (!role) return needs(key, 'We do not know the role title');
    return filled(key, `I am applying for the ${role} role at ${name}. It fits my ${ev.text}, and I want to build on it.`, [nameEv, { source: 'company', field: 'role', value: role }, ev.source]);
  }
  const line = about(company);
  if (!line) return needs(key, 'We have no line about what the company does');
  return filled(key, `What draws me to ${name} is its work: ${line}. My ${ev.text} is the kind of experience I would bring to it.`, [nameEv, { source: 'company', field: 'about', value: line }, ev.source]);
}

function academic(profile: AnswerProfile, o: AnswerOptions): Pick<AnswerSet, 'pct_10' | 'pct_12' | 'cgpa' | 'percentage' | 'cgpa_pct'> {
  const e = profile.eligibility;
  const ok = !!e && (e as { confirmed?: unknown }).confirmed === true;
  const none = (k: AnswerKey, why: string) => needs(k, why);
  const why = 'Your academic details are not confirmed yet';
  if (!ok || !e) return { pct_10: none('pct_10', why), pct_12: none('pct_12', why), cgpa: none('cgpa', why), percentage: none('percentage', why), cgpa_pct: none('cgpa_pct', why) };

  const pct10 = isNum(e.pct_10) && e.pct_10 >= 0 && e.pct_10 <= 100 ? filled('pct_10', `${trimNum(e.pct_10)}%`, [{ source: 'profile', field: 'pct_10', value: `${trimNum(e.pct_10)}%` }]) : none('pct_10', 'Your 10th percentage is missing');
  const pct12 =
    e.secondary_kind === '12th' && isNum(e.pct_secondary) && e.pct_secondary >= 0 && e.pct_secondary <= 100
      ? filled('pct_12', `${trimNum(e.pct_secondary)}%`, [{ source: 'profile', field: 'pct_secondary', value: `${trimNum(e.pct_secondary)}%` }])
      : none('pct_12', e.secondary_kind === 'diploma' ? 'You did a diploma, not 12th' : 'Your 12th percentage is missing');

  const score = e.grad_score;
  const scale = e.grad_scale;
  let cgpa: Answer = none('cgpa', 'You gave a percentage, not a CGPA');
  let percentage: Answer = none('percentage', 'Your graduation score is missing');
  if (isNum(score) && score >= 0) {
    if ((scale === 10 || scale === 4 || scale === 5) && score <= scale) {
      const v = `${trimNum(score)}/${scale}`;
      cgpa = filled('cgpa', v, [{ source: 'profile', field: 'grad_score', value: v }]);
      const printed = e.grad_conversion === 'direct' && isNum(e.grad_pct_equiv) && e.grad_pct_equiv >= 0 && e.grad_pct_equiv <= 100;
      if (scale === 10 && printed) {
        // The percentage the university printed wins over any rule conversion, exactly as eligibility does, so the submitted
        // percentage is the one the student was judged on.
        const v2 = `${trimNum(e.grad_pct_equiv as number)}%`;
        percentage = filled('percentage', v2, [{ source: 'profile', field: 'grad_pct_equiv', value: v2 }]);
      } else if (scale === 10) {
        const campus: CgpaRule = o.campusRule ?? null;
        const { conv, missing } = resolveConversion({ cgpaRule: campus, universityRule: o.universityRule ?? null, universityRuleConfirmed: o.universityRuleConfirmed === true });
        const pct = conv ? applyCgpaRule(score, conv.rule as NonNullable<CgpaRule>) : null;
        if (conv && pct !== null) {
          const v2 = `${fmt1(round1(pct))}%`;
          percentage = filled('percentage', v2, [{ source: 'rule', field: 'grad_score', value: v2, basis: `${score.toFixed(1)} CGPA = ${v2} by ${conv.who}` }]);
        } else percentage = none('percentage', `Your CGPA needs a CGPA to % rule first. ${missing}`);
      } else percentage = none('percentage', 'There is no % rule for a CGPA on this scale');
    } else if (scale === 100 && score <= 100) {
      const v = `${trimNum(score)}%`;
      percentage = filled('percentage', v, [{ source: 'profile', field: 'grad_score', value: v }]);
    }
  }
  if (percentage.status === 'needs_you' && e.grad_conversion === 'direct' && isNum(e.grad_pct_equiv) && e.grad_pct_equiv >= 0 && e.grad_pct_equiv <= 100) {
    const v = `${trimNum(e.grad_pct_equiv)}%`;
    percentage = filled('percentage', v, [{ source: 'profile', field: 'grad_pct_equiv', value: v }]);
  }
  const cgpaPct: Answer = cgpa.status === 'filled' ? { ...cgpa, key: 'cgpa_pct' } : percentage.status === 'filled' ? { ...percentage, key: 'cgpa_pct' } : none('cgpa_pct', percentage.reason ?? 'Your graduation score is missing');
  return { pct_10: pct10, pct_12: pct12, cgpa, percentage, cgpa_pct: cgpaPct };
}

function authorisation(profile: AnswerProfile, o: AnswerOptions): Pick<AnswerSet, 'work_authorization' | 'visa_sponsorship'> {
  const country = str(o.country)?.toUpperCase();
  const row = country ? (profile.workAuthorizations ?? []).find((w) => w?.country === country) : undefined;
  const miss = (k: AnswerKey): Answer => needs(k, country ? `Your work status for ${country} is not on file` : 'The job country is not known');
  if (!row) return { work_authorization: miss('work_authorization'), visa_sponsorship: miss('visa_sponsorship') };
  const ev = (k: string): AnswerEvidence => ({ source: 'profile', field: 'workAuthorizations', value: k, basis: `${country}: ${row.status}` });
  const yes = row.status !== 'needs_sponsorship';
  const wa = filled('work_authorization', yes ? 'Yes' : 'No', [{ ...ev(yes ? 'Yes' : 'No') }]);
  let vs: Answer;
  if (row.status === 'visa_held') vs = needs('visa_sponsorship', 'You hold a visa here, and only you know if it will need sponsoring later');
  else {
    const v = row.status === 'needs_sponsorship' ? 'Yes' : 'No';
    vs = filled('visa_sponsorship', v, [ev(v)]);
  }
  return { work_authorization: wa, visa_sponsorship: vs };
}

export function answerFrom(profile: AnswerProfile | null | undefined, answerBank: readonly AnswerBankEntry[] | null | undefined, resumeFacts: ResumeFacts | null | undefined, company: CompanyFacts | null | undefined, options: AnswerOptions = {}): AnswerSet {
  const p: AnswerProfile = profile ?? {};
  const bank = Array.isArray(answerBank) ? answerBank : [];
  const resume: ResumeFacts = resumeFacts ?? { confirmed: false, skills: [], projects: [], experience: [], links: [] };
  const o = options ?? {};

  const direct = (k: AnswerKey, v: unknown, field: string, why: string): Answer => {
    const s = str(v);
    return s ? filled(k, s, [{ source: 'profile', field, value: s }]) : needs(k, why);
  };
  const link = (k: 'linkedin' | 'github', ok: (u: string) => boolean): Answer => {
    const own = str(p[k]);
    if (own && ok(own)) return filled(k, own, [{ source: 'profile', field: k, value: own }]);
    if (resume.confirmed === true) {
      const hit = (resume.links ?? []).map(str).find((u): u is string => u !== null && ok(u));
      if (hit) return filled(k, hit, [{ source: 'resume', field: 'links', value: hit }]);
    }
    return needs(k, `Your ${k === 'linkedin' ? 'LinkedIn' : 'GitHub'} link is not on file`);
  };
  const acad = academic(p, o);
  const auth = authorisation(p, o);
  const nb = (k: AnswerKey, why: string): Answer => fromBank(k, bank) ?? needs(k, why);

  const set: AnswerSet = {
    name: direct('name', p.fullName, 'fullName', 'Your name is missing'),
    email: direct('email', p.email, 'email', 'Your email is missing'),
    phone: direct('phone', p.phone, 'phone', 'Your phone number is missing'),
    grad_year: isNum(p.passoutYear) ? filled('grad_year', String(p.passoutYear), [{ source: 'profile', field: 'passoutYear', value: String(p.passoutYear) }]) : needs('grad_year', 'Your graduation year is missing'),
    degree: direct('degree', p.degree, 'degree', 'Your degree is missing'),
    ...acad,
    notice_period: nb('notice_period', 'Only you can say when you can join'),
    relocation: nb('relocation', 'Only you can say if you will relocate'),
    expected_ctc: nb('expected_ctc', 'Only you can say what pay you expect'),
    current_ctc: nb('current_ctc', 'Only you can say your current pay'),
    linkedin: link('linkedin', isLinkedin),
    github: link('github', isGithub),
    work_authorization: fromBank('work_authorization', bank) ?? auth.work_authorization,
    visa_sponsorship: fromBank('visa_sponsorship', bank) ?? auth.visa_sponsorship,
    gender_eeo: needs('gender_eeo', 'Demographic questions are always yours to answer'),
    sensitive_id: needs('sensitive_id', 'Family and ID details are never filled for you'),
    why_company: fromBank('why_company', bank) ?? templates('why_company', p, resume, company ?? null),
    why_role: fromBank('why_role', bank) ?? templates('why_role', p, resume, company ?? null),
    about_yourself: fromBank('about_yourself', bank) ?? templates('about_yourself', p, resume, company ?? null),
  };
  for (const k of ANSWER_KEYS) if (SENSITIVE_KEYS.has(k)) set[k] = needs(k, set[k].reason ?? '');
  return set;
}

const optNorm = (x: string): string => x.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Classify a form question and look its answer up. Unknown questions are always "Needs you". When the form offers
 * options, a filled value must be one of them (case and spacing ignored), or the answer is "Needs you": an email
 * never goes to a Yes/No question.
 */
export function answerQuestion(label: string, options: readonly string[] | undefined, set: AnswerSet): Answer {
  const { key } = classifyQuestion(label, options);
  if (key === 'unknown') return needs('unknown', 'We do not recognise this question yet');
  const a = set[key];
  const list = Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string' && o.trim() !== '') : [];
  if (a.status === 'filled' && list.length > 0) {
    const v = optNorm(a.value ?? '');
    if (!list.some((o) => optNorm(o) === v)) return needs(key, 'None of the options on this form match your answer');
  }
  return a;
}
