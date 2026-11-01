import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answerFrom, answerQuestion, classifyQuestion, type AnswerInputs } from '../src/answers';
import { findUniversityRule } from '../src/eligibility/university';

interface Row { id: string; label: string; options?: string[]; key: string }
const rows = readFileSync(new URL('./corpus/questions.labelled.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).slice(1).map((l) => JSON.parse(l) as Row);

describe('corpus', () => {
  it('has at least 120 labelled labels and covers every known key', () => {
    expect(rows.length).toBeGreaterThanOrEqual(120);
    const keys = new Set(rows.map((r) => r.key));
    for (const k of ['name', 'email', 'phone', 'grad_year', 'degree', 'cgpa_pct', 'notice_period', 'relocation', 'expected_ctc', 'current_ctc', 'linkedin', 'github', 'work_authorization', 'gender_eeo', 'why_company', 'why_role', 'about_yourself', 'unknown']) expect(keys.has(k), k).toBe(true);
  });
  it('known-key accuracy is at least 0.95 and traps never become known keys', () => {
    const known = rows.filter((r) => r.key !== 'unknown');
    const wrong = known.filter((r) => classifyQuestion(r.label, r.options).key !== r.key);
    expect(1 - wrong.length / known.length, JSON.stringify(wrong.map((w) => [w.label, classifyQuestion(w.label, w.options).key]))).toBeGreaterThanOrEqual(0.95);
    const forced = rows.filter((r) => r.key === 'unknown' && classifyQuestion(r.label, r.options).key !== 'unknown');
    expect(forced.map((f) => [f.label, classifyQuestion(f.label, f.options).key])).toEqual([]);
  });
});

describe('classifyQuestion review traps', () => {
  const k = (l: string, o?: string[]) => classifyQuestion(l, o).key;
  it('a "why" about leaving is not why-company or why-role', () => {
    expect(k('Why did you leave your last job?')).toBe('unknown');
    expect(k('Why do you want to leave your current company?')).toBe('unknown');
    expect(k('Why are you switching careers?')).toBe('unknown');
  });
  it('"why" with intent words still maps', () => {
    expect(k('Why do you want to work at Acme?')).toBe('why_company');
    expect(k('Why are you interested in this role?')).toBe('why_role');
  });
  it('relocation assistance and degree start dates are not what they look like', () => {
    expect(k('Do you require relocation assistance?')).toBe('unknown');
    expect(k('When did you start your degree?')).toBe('unknown');
    expect(k('When can you start?')).toBe('notice_period');
  });
});

describe('answerQuestion with options', () => {
  const set = answerFrom(INPUT.profile, INPUT.answerBank, INPUT.resumeFacts, INPUT.company);
  it('a filled value must be one of the options, else Needs you', () => {
    expect(answerQuestion('Are you willing to relocate?', ['Yes', 'No'], set).value).toBe('Yes');
    expect(answerQuestion('Are you willing to relocate?', ['yes ', ' NO'], set).status).toBe('filled');
    const miss = answerQuestion('Degree', ['B.Tech/B.E.', 'M.Tech'], set);
    expect(miss.status).toBe('needs_you');
    expect(miss.value).toBeNull();
    expect(miss.reason).toMatch(/options/i);
  });
  it('a free-text question with no options keeps the value; an empty options list means free text', () => {
    expect(answerQuestion('Degree', undefined, set).value).toBe('B.Tech');
    expect(answerQuestion('Degree', [], set).value).toBe('B.Tech');
  });
  it('an email never goes to a Yes/No question', () => {
    const a = answerQuestion('Email', ['Yes', 'No'], set);
    expect(a.status).toBe('needs_you');
  });
});

describe('classifyQuestion traps', () => {
  const k = (l: string, o?: string[]) => classifyQuestion(l, o).key;
  it('sponsorship is the inverse of work authorisation', () => {
    expect(k('Do you require visa sponsorship?')).toBe('visa_sponsorship');
    expect(k('Are you legally authorized to work in India?')).toBe('work_authorization');
  });
  it("father's name is not the candidate's name", () => {
    expect(k("Father's name")).toBe('sensitive_id');
    expect(k('Company name')).toBe('unknown');
    expect(k('Reference name')).toBe('unknown');
  });
  it('current and expected CTC are different; a bare CTC is unknown', () => {
    expect(k('Current CTC')).toBe('current_ctc');
    expect(k('Expected CTC')).toBe('expected_ctc');
    expect(k('CTC')).toBe('unknown');
  });
  it('12th year is not graduation year; 12th % is its own key', () => {
    expect(k('12th passing year')).toBe('unknown');
    expect(k('Graduation year')).toBe('grad_year');
    expect(k('12th percentage')).toBe('pct_12');
  });
  it('options tip a vague label into EEO', () => {
    expect(k('How do you identify?', ['Male', 'Female', 'Decline to self identify'])).toBe('gender_eeo');
    expect(k('Select one', ['Yes', 'No'])).toBe('unknown');
  });
  it('handles junk input', () => {
    for (const bad of ['', '   ', null, undefined, 5 as unknown as string, '😀😀', 'x'.repeat(5000)]) expect(k(bad as string)).toBe('unknown');
  });
  it('ignores asterisks, case, curly quotes and (optional)', () => {
    expect(k('  FATHER’S NAME *  (optional)')).toBe('sensitive_id');
    expect(k('E-MAIL*')).toBe('email');
  });
  it('asking for CGPA vs percentage vs either', () => {
    expect(k('CGPA')).toBe('cgpa');
    expect(k('Percentage in graduation')).toBe('percentage');
    expect(k('CGPA / Percentage')).toBe('cgpa_pct');
  });
});

const INPUT: AnswerInputs = {
  profile: {
    fullName: 'Asha Rao',
    email: 'asha.rao@example.test',
    phone: '+91 90000 00000',
    linkedin: 'https://www.linkedin.com/in/asha-rao-test',
    github: 'https://github.com/asharao-test',
    degree: 'B.Tech',
    passoutYear: 2026,
    eligibility: { pct_10: 88, secondary_kind: '12th', pct_secondary: 81, grad_score: 8.1, grad_scale: 10, confirmed: true },
  },
  answerBank: [
    { questionKey: 'notice_period', answer: 'Immediate', source: 'user' },
    { questionKey: 'relocation', answer: 'Yes', source: 'user' },
    { questionKey: 'gender_eeo', answer: 'Female', source: 'user' },
  ],
  resumeFacts: {
    confirmed: true,
    skills: ['Python', 'SQL', 'React'],
    projects: [{ title: 'Campus bus tracker' }],
    experience: [{ role: 'Data intern', org: 'Example Labs' }],
    links: [],
  },
  company: { name: 'Acme Robotics', about: 'builds warehouse robots for small retailers', role: 'Software Engineer' },
};

describe('answerFrom', () => {
  const set = answerFrom(INPUT.profile, INPUT.answerBank, INPUT.resumeFacts, INPUT.company);
  it('fills direct fields with evidence equal to the value', () => {
    for (const [key, value] of [['name', 'Asha Rao'], ['email', 'asha.rao@example.test'], ['phone', '+91 90000 00000'], ['grad_year', '2026'], ['degree', 'B.Tech'], ['pct_10', '88%'], ['pct_12', '81%']] as const) {
      expect(set[key].status, key).toBe('filled');
      expect(set[key].value, key).toBe(value);
      expect(set[key].evidence.some((e) => e.value === value), key).toBe(true);
    }
  });
  it('takes bank answers the student gave', () => {
    expect(set.notice_period.value).toBe('Immediate');
    expect(set.notice_period.evidence[0]!.source).toBe('answer_bank');
    expect(set.relocation.value).toBe('Yes');
  });
  it('gender/EEO is always Needs you, even with a bank answer', () => {
    expect(set.gender_eeo.status).toBe('needs_you');
    expect(set.gender_eeo.value).toBeNull();
  });
  it('sensitive ids are Needs you', () => {
    expect(set.sensitive_id.status).toBe('needs_you');
  });
  it('anything with no evidence is Needs you', () => {
    for (const k of ['expected_ctc', 'current_ctc', 'work_authorization', 'visa_sponsorship'] as const) {
      expect(set[k].status, k).toBe('needs_you');
      expect(set[k].evidence).toEqual([]);
    }
  });
  it('CGPA is answered as written; a percentage question with only a CGPA and no rule is Needs you', () => {
    expect(set.cgpa.value).toBe('8.1/10');
    expect(set.percentage.status).toBe('needs_you');
    expect(set.percentage.reason).toMatch(/rule/i);
    expect(set.cgpa_pct.value).toBe('8.1/10');
  });
  it('a percentage via a confirmed rule carries the maths as evidence', () => {
    const s = answerFrom(INPUT.profile, INPUT.answerBank, INPUT.resumeFacts, INPUT.company, { universityRule: findUniversityRule('rgpv'), universityRuleConfirmed: true });
    expect(s.percentage.value).toBe('77.0%');
    expect(s.percentage.evidence[0]!.basis).toBe("8.1 CGPA = 77.0% by RGPV's rule");
    const unconfirmed = answerFrom(INPUT.profile, INPUT.answerBank, INPUT.resumeFacts, INPUT.company, { universityRule: findUniversityRule('rgpv') });
    expect(unconfirmed.percentage.status).toBe('needs_you');
  });
  it('a VTU percentage is never filled without a scheme; with one it follows that scheme', () => {
    const vtu = findUniversityRule('vtu');
    const none = answerFrom(INPUT.profile, INPUT.answerBank, INPUT.resumeFacts, INPUT.company, { universityRule: vtu, universityRuleConfirmed: true });
    expect(none.percentage.status).toBe('needs_you');
    expect(none.percentage.reason).toContain('which VTU scheme');
    const s22 = answerFrom(INPUT.profile, INPUT.answerBank, INPUT.resumeFacts, INPUT.company, { universityRule: vtu, universityRuleConfirmed: true, universityScheme: '2022' });
    expect(s22.percentage.value).toBe('81.0%');
    const s18 = answerFrom(INPUT.profile, INPUT.answerBank, INPUT.resumeFacts, INPUT.company, { universityRule: vtu, universityRuleConfirmed: true, admissionYear: 2018 });
    expect(s18.percentage.value).toBe('73.5%');
  });
  it('a disputed Mumbai rule is never used to fill a percentage', () => {
    const s = answerFrom(INPUT.profile, INPUT.answerBank, INPUT.resumeFacts, INPUT.company, { universityRule: findUniversityRule('mumbai'), universityRuleConfirmed: true });
    expect(s.percentage.status).toBe('needs_you');
    expect(s.percentage.reason).toContain('Use the percentage on your marksheet');
  });
  it('a stated percentage is answered directly', () => {
    const s = answerFrom({ ...INPUT.profile, eligibility: { grad_score: 72.5, grad_scale: 100, confirmed: true } }, [], INPUT.resumeFacts, INPUT.company);
    expect(s.percentage.value).toBe('72.5%');
    expect(s.cgpa.status).toBe('needs_you');
    expect(s.cgpa_pct.value).toBe('72.5%');
  });
  it('an unconfirmed eligibility profile gives no academic answers', () => {
    const s = answerFrom({ ...INPUT.profile, eligibility: { ...INPUT.profile.eligibility!, confirmed: false as never } }, [], INPUT.resumeFacts, INPUT.company);
    expect(s.pct_10.status).toBe('needs_you');
    expect(s.cgpa.status).toBe('needs_you');
  });
  it('work authorisation and sponsorship come from a stated country status only', () => {
    const p = { ...INPUT.profile, workAuthorizations: [{ country: 'IN', status: 'citizen' as const }] };
    const s = answerFrom(p, [], INPUT.resumeFacts, INPUT.company, { country: 'IN' });
    expect(s.work_authorization.value).toBe('Yes');
    expect(s.visa_sponsorship.value).toBe('No');
    const us = answerFrom(p, [], INPUT.resumeFacts, INPUT.company, { country: 'US' });
    expect(us.work_authorization.status).toBe('needs_you');
    const need = answerFrom({ ...INPUT.profile, workAuthorizations: [{ country: 'US', status: 'needs_sponsorship' as const }] }, [], INPUT.resumeFacts, INPUT.company, { country: 'US' });
    expect(need.work_authorization.value).toBe('No');
    expect(need.visa_sponsorship.value).toBe('Yes');
    const held = answerFrom({ ...INPUT.profile, workAuthorizations: [{ country: 'US', status: 'visa_held' as const }] }, [], INPUT.resumeFacts, INPUT.company, { country: 'US' });
    expect(held.visa_sponsorship.status).toBe('needs_you');
  });
  it('linkedin and github come from the profile or from a confirmed resume', () => {
    expect(set.linkedin.value).toBe('https://www.linkedin.com/in/asha-rao-test');
    const s = answerFrom({ fullName: 'A' }, [], { ...INPUT.resumeFacts, links: ['https://github.com/from-resume', 'https://example.test'] }, INPUT.company);
    expect(s.github.value).toBe('https://github.com/from-resume');
    expect(s.github.evidence[0]!.source).toBe('resume');
    expect(s.linkedin.status).toBe('needs_you');
    const unconfirmed = answerFrom({ fullName: 'A' }, [], { ...INPUT.resumeFacts, confirmed: false, links: ['https://github.com/from-resume'] }, INPUT.company);
    expect(unconfirmed.github.status).toBe('needs_you');
  });
  it('rejects look-alike links', () => {
    const s = answerFrom({ ...INPUT.profile, linkedin: 'https://evil.test/linkedin.com/in/x', github: 'javascript:alert(1)' }, [], { ...INPUT.resumeFacts, links: [] }, INPUT.company);
    expect(s.linkedin.status).toBe('needs_you');
    expect(s.github.status).toBe('needs_you');
  });
});

describe('free-text templates', () => {
  const set = answerFrom(INPUT.profile, [], INPUT.resumeFacts, INPUT.company);
  it('why_company uses the company about line and the strongest confirmed evidence', () => {
    const a = set.why_company;
    expect(a.status).toBe('filled');
    expect(a.value).toContain('builds warehouse robots for small retailers');
    expect(a.value).toContain('Acme Robotics');
    expect(a.value).toContain('Data intern');
    for (const e of a.evidence) expect(a.value).toContain(e.value);
    expect(a.evidence.map((e) => e.source).sort()).toEqual(['company', 'company', 'resume']);
  });
  it('why_role needs a role; about_yourself needs a degree', () => {
    expect(set.why_role.status).toBe('filled');
    expect(set.why_role.value).toContain('Software Engineer');
    expect(answerFrom(INPUT.profile, [], INPUT.resumeFacts, { name: 'Acme', about: 'x y z' }).why_role.status).toBe('needs_you');
    expect(set.about_yourself.value).toContain('B.Tech');
    expect(answerFrom({ fullName: 'A' }, [], INPUT.resumeFacts, INPUT.company).about_yourself.status).toBe('needs_you');
  });
  it('no company about line, no evidence, or an unconfirmed resume: Needs you', () => {
    expect(answerFrom(INPUT.profile, [], INPUT.resumeFacts, { name: 'Acme', about: '  ' }).why_company.status).toBe('needs_you');
    expect(answerFrom(INPUT.profile, [], { confirmed: true, skills: [], projects: [], experience: [], links: [] }, INPUT.company).why_company.status).toBe('needs_you');
    expect(answerFrom(INPUT.profile, [], { ...INPUT.resumeFacts, confirmed: false }, INPUT.company).why_company.status).toBe('needs_you');
    expect(answerFrom(INPUT.profile, [], INPUT.resumeFacts, null).why_company.status).toBe('needs_you');
  });
  it('picks experience over projects over skills', () => {
    const noExp = answerFrom(INPUT.profile, [], { ...INPUT.resumeFacts, experience: [] }, INPUT.company);
    expect(noExp.why_company.value).toContain('Campus bus tracker');
    const skillsOnly = answerFrom(INPUT.profile, [], { ...INPUT.resumeFacts, experience: [], projects: [] }, INPUT.company);
    expect(skillsOnly.why_company.value).toContain('Python, SQL and React');
  });
  it('is deterministic', () => {
    expect(answerFrom(INPUT.profile, [], INPUT.resumeFacts, INPUT.company)).toEqual(set);
  });
  it('a bank answer for a free-text key wins over the template', () => {
    const s = answerFrom(INPUT.profile, [{ questionKey: 'why_company', answer: 'My own words.', source: 'user' }], INPUT.resumeFacts, INPUT.company);
    expect(s.why_company.value).toBe('My own words.');
  });
});

describe('answerQuestion', () => {
  const set = answerFrom(INPUT.profile, INPUT.answerBank, INPUT.resumeFacts, INPUT.company);
  it('classifies and looks up; unknown questions are Needs you', () => {
    expect(answerQuestion('Full name*', undefined, set).value).toBe('Asha Rao');
    const u = answerQuestion('Describe a challenge you overcame', undefined, set);
    expect(u.status).toBe('needs_you');
    expect(u.key).toBe('unknown');
  });
});
