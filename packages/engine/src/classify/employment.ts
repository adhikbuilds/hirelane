/**
 * Employment type (recon vocabulary). A title that says intern overrides a structured FullTime.
 */
import { evidence } from '../internal/tracer';
import { TraceBuilder } from '../trace';
import type { Classified, ClassifyInput } from './types';

export type Employment = 'fulltime' | 'parttime' | 'contract' | 'intern';

const STRUCTURED: Readonly<Record<string, Employment>> = {
  fulltime: 'fulltime',
  fulltimeemployee: 'fulltime',
  fulltimeemployment: 'fulltime',
  fte: 'fulltime',
  permanent: 'fulltime',
  regular: 'fulltime',
  regularfulltime: 'fulltime',
  onroll: 'fulltime',
  employee: 'fulltime',
  parttime: 'parttime',
  parttimeemployee: 'parttime',
  contract: 'contract',
  contractor: 'contract',
  contractual: 'contract',
  temporary: 'contract',
  temp: 'contract',
  freelance: 'contract',
  freelancer: 'contract',
  fixedterm: 'contract',
  intern: 'intern',
  internship: 'intern',
  coop: 'intern',
};

const TITLE_INTERN = /\b(?:intern|interns|internship|internships|co[- ]?op|working student|werkstudent)\b/i;
const TITLE_OTHER: { value: Employment; re: RegExp }[] = [
  { value: 'contract', re: /\b(?:contract(?:or)?|freelance|temporary|temp|fixed[- ]term)\b/i },
  { value: 'parttime', re: /\bpart[- ]time\b/i },
];
const DESC: { value: Employment; re: RegExp }[] = [
  { value: 'intern', re: /\bthis is an? (?:paid )?(?:\d+[- ]month |summer |winter |spring |fall )?internship\b|\binternship (?:program|position|role)\b/i },
  { value: 'contract', re: /\bthis is an? (?:\d+[- ]month |fixed[- ]term |temporary )?contract (?:position|role|opportunity)\b|\bcontract (?:position|role) \(|\bfixed[- ]term contract\b|\b\d+[- ]month contract\b|\bcontract-to-hire\b|\bcontract to hire\b/i },
  { value: 'parttime', re: /\bthis is a part[- ]time (?:position|role|job|opportunity)\b|\bpart[- ]time (?:position|role|job)\b/i },
  { value: 'fulltime', re: /\bthis is a full[- ]time (?:position|role|job|opportunity)\b|\bfull[- ]time (?:position|role|job|employee|employment|opportunity)\b|\bfull[- ]time,? (?:permanent|regular)\b|\bpermanent (?:position|role|employment)\b/i },
];

const key = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');

export function classifyEmployment(i: ClassifyInput): Classified<Employment | null> {
  const tb = new TraceBuilder('employment');
  const structured = i.employmentRaw !== null && key(i.employmentRaw) in STRUCTURED ? (STRUCTURED[key(i.employmentRaw)] as Employment) : null;
  if (i.employmentRaw !== null && structured === null) {
    tb.step({
      ruleId: 'employment.structured_unknown',
      op: 'reject',
      label: `Structured employment "${i.employmentRaw}" is not recognised`,
      inputs: { employmentRaw: i.employmentRaw },
      output: null,
      evidence: [evidence('employment_raw', i.employmentRaw, 0, i.employmentRaw.length)],
    });
  }

  const ti = TITLE_INTERN.exec(i.title);
  if (ti) {
    const ev = evidence('title', i.title, ti.index, ti.index + ti[0].length);
    if (structured !== null && structured !== 'intern') {
      tb.step({
        ruleId: 'employment.select',
        op: 'select',
        label: `Title says intern; structured "${i.employmentRaw as string}" (${structured}) loses`,
        inputs: { structured },
        output: 'intern',
        evidence: [ev, evidence('employment_raw', i.employmentRaw as string, 0, (i.employmentRaw as string).length)],
      });
    }
    tb.step({ ruleId: 'employment.title_intern', op: 'classify', label: `Title "${ev.quote}" means intern`, inputs: { title: i.title }, output: 'intern', evidence: [ev] });
    return { value: 'intern', evidence: [ev], trace: tb.build('value') };
  }

  if (structured !== null) {
    const raw = i.employmentRaw as string;
    const ev = evidence('employment_raw', raw, 0, raw.length);
    tb.step({ ruleId: 'employment.structured', op: 'classify', label: `Structured "${raw}" means ${structured}`, inputs: { employmentRaw: raw }, output: structured, evidence: [ev] });
    return { value: structured, evidence: [ev], trace: tb.build('value') };
  }

  for (const t of TITLE_OTHER) {
    const m = t.re.exec(i.title);
    if (m) {
      const ev = evidence('title', i.title, m.index, m.index + m[0].length);
      tb.step({ ruleId: 'employment.title', op: 'classify', label: `Title "${ev.quote}" means ${t.value}`, inputs: { title: i.title }, output: t.value, evidence: [ev] });
      return { value: t.value, evidence: [ev], trace: tb.build('value') };
    }
  }

  let best: { value: Employment; start: number; end: number } | null = null;
  for (const d of DESC) {
    const m = d.re.exec(i.doc.text);
    if (m && (best === null || m.index < best.start)) best = { value: d.value, start: m.index, end: m.index + m[0].length };
  }
  if (best) {
    const ev = evidence('description', i.doc.text, best.start, best.end);
    tb.step({ ruleId: 'employment.description_phrase', op: 'classify', label: `Description says "${ev.quote}": ${best.value}`, inputs: {}, output: best.value, evidence: [ev] });
    return { value: best.value, evidence: [ev], trace: tb.build('value') };
  }
  tb.step({ ruleId: 'employment.none', op: 'default', label: 'No employment-type signal', inputs: {}, output: null });
  return { value: null, evidence: [], trace: tb.build('null') };
}
