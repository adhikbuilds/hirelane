/**
 * engine:eval hook: application answers without an LLM.
 * Gates: known-key accuracy >= 0.95, 0 trap labels forced into a known key, 0 invented answers, 0 sensitive fills.
 * "Invented" = a filled answer with no evidence, or evidence that does not match the answer, or evidence whose value
 * cannot be found in the inputs it claims to come from.
 */
import { readFileSync } from 'node:fs';
import { ANSWER_KEYS, answerFrom, answerQuestion, classifyQuestion } from '../../src/answers';
import type { Answer, AnswerInputs, AnswerSet } from '../../src/answers';
import { findUniversityRule } from '../../src/eligibility/university';

const MIN_ACCURACY = 0.95;
const MIN_ROWS = 120;
interface Row { id: string; label: string; options?: string[]; key: string }

const base: AnswerInputs = {
  profile: {
    fullName: 'Asha Rao', email: 'asha.rao@example.test', phone: '+91 90000 00000',
    linkedin: 'https://www.linkedin.com/in/asha-rao-test', github: 'https://github.com/asharao-test',
    degree: 'B.Tech', passoutYear: 2026,
    workAuthorizations: [{ country: 'IN', status: 'citizen' }],
    eligibility: { pct_10: 88, secondary_kind: '12th', pct_secondary: 81, grad_score: 8.1, grad_scale: 10, confirmed: true },
  },
  answerBank: [
    { questionKey: 'notice_period', answer: 'Immediate', source: 'user' },
    { questionKey: 'relocation', answer: 'Yes', source: 'user' },
    { questionKey: 'gender_eeo', answer: 'Female', source: 'user' },
    { questionKey: 'sensitive_id', answer: 'Test Parent', source: 'user' },
  ],
  resumeFacts: { confirmed: true, skills: ['Python', 'SQL', 'React'], projects: [{ title: 'Campus bus tracker' }], experience: [{ role: 'Data intern', org: 'Example Labs' }], links: ['https://github.com/from-resume'] },
  company: { name: 'Acme Robotics', about: 'builds warehouse robots for small retailers', role: 'Software Engineer' },
};
const sparse: AnswerInputs = { profile: {}, answerBank: [], resumeFacts: { confirmed: false, skills: ['Excel'], projects: [], experience: [], links: [] }, company: null };
const rule = findUniversityRule('rgpv');

/** Every string the answer engine was given, so evidence can be traced back to it. */
function haystack(i: AnswerInputs, extra: string[]): string {
  return JSON.stringify(i) + '\n' + extra.join('\n');
}

function invented(a: Answer, hay: string): string | null {
  if (a.status === 'needs_you') return a.value === null && a.evidence.length === 0 ? null : 'needs_you carries a value or evidence';
  if (a.value === null || a.value.length === 0) return 'filled without a value';
  if (a.evidence.length === 0) return 'filled without evidence';
  const direct = a.evidence.some((e) => e.value === a.value);
  const template = a.evidence.every((e) => a.value!.includes(e.value));
  if (!direct && !template) return 'evidence does not match the answer';
  for (const e of a.evidence) {
    if (e.source === 'rule') {
      if (!e.basis) return 'derived value without its maths';
      continue;
    }
    const raw = e.value.replace(/^project "(.*)"$/, '$1').replace(/^skills in /, '').replace(/ experience at .*/, '');
    const probes = e.field === 'skills' ? raw.split(/, | and /) : e.field === 'passoutYear' || e.field === 'workAuthorizations' ? [] : [raw.replace(/%$/, '').replace(/\/\d+$/, '')];
    for (const pr of probes) if (pr && !hay.includes(pr) && !hay.includes(JSON.stringify(pr).slice(1, -1))) return `evidence "${e.value}" not found in inputs`;
  }
  return null;
}

export default {
  name: 'answers  (test/corpus/questions.labelled.jsonl)',
  run() {
    const raw = readFileSync(new URL('../../test/corpus/questions.labelled.jsonl', import.meta.url), 'utf8');
    const rows = raw.split('\n').filter(Boolean).slice(1).map((l) => JSON.parse(l) as Row);
    const known = rows.filter((r) => r.key !== 'unknown');
    const wrong = known.filter((r) => classifyQuestion(r.label, r.options).key !== r.key);
    const forced = rows.filter((r) => r.key === 'unknown' && classifyQuestion(r.label, r.options).key !== 'unknown');
    const accuracy = known.length ? 1 - wrong.length / known.length : 0;

    const sets: [string, AnswerInputs, AnswerSet][] = [
      ['full', base, answerFrom(base.profile, base.answerBank, base.resumeFacts, base.company, { country: 'IN', universityRule: rule, universityRuleConfirmed: true })],
      ['unconfirmed-rule', base, answerFrom(base.profile, base.answerBank, base.resumeFacts, base.company, { country: 'US', universityRule: rule })],
      ['sparse', sparse, answerFrom(sparse.profile, sparse.answerBank, sparse.resumeFacts, sparse.company)],
    ];
    let checked = 0;
    let bad = 0;
    let sensitiveFilled = 0;
    let optionMismatch = 0;
    const examples: string[] = [];
    for (const [name, inp, set] of sets) {
      const hay = haystack(inp, []);
      for (const k of ANSWER_KEYS) {
        checked++;
        const why = invented(set[k], hay);
        if (why) {
          bad++;
          examples.push(`${name}/${k}: ${why}`);
        }
      }
      for (const r of rows) {
        const a = answerQuestion(r.label, r.options, set);
        const cls = classifyQuestion(r.label, r.options).key;
        if (a.status === 'filled' && r.options && r.options.length > 0 && !r.options.some((o) => o.trim().toLowerCase() === (a.value ?? '').trim().toLowerCase())) optionMismatch++;
        if ((cls === 'gender_eeo' || cls === 'sensitive_id' || cls === 'unknown') && a.status === 'filled') sensitiveFilled++;
      }
    }
    const ok = rows.length >= MIN_ROWS && accuracy >= MIN_ACCURACY && forced.length === 0 && bad === 0 && sensitiveFilled === 0 && optionMismatch === 0;
    return {
      ok,
      lines: [
        `${rows.length} labels (gate >= ${MIN_ROWS}): known-key accuracy ${(accuracy * 100).toFixed(2)}% (${known.length - wrong.length}/${known.length}) (>= ${MIN_ACCURACY * 100}%); traps forced into a known key ${forced.length} (must be 0)`,
        `${checked} answers checked over 3 profiles: invented ${bad} (must be 0); EEO/ID/unknown filled ${sensitiveFilled} (must be 0); value outside the form's options ${optionMismatch} (must be 0)`,
        ...wrong.slice(0, 5).map((w) => `  miss ${w.id}: ${w.label} -> ${classifyQuestion(w.label, w.options).key} (want ${w.key})`),
        ...examples.slice(0, 5).map((e) => '  ' + e),
      ],
    };
  },
};
