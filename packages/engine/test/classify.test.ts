import { describe, expect, it } from 'vitest';
import {
  LEVELS,
  ROLE_FAMILIES,
  classifyEmployment,
  classifyLevel,
  classifyRoleFamily,
  classifyWorkplace,
  detectVisa,
  levelDistance,
  toPublicLevel,
  type ClassifyInput,
  type Level,
} from '../src/classify';
import rolesData from '../data/role-families.json';
import { canonicalTitle } from '../src/dedup';
import { extractSkills } from '../src/skills';
import { docFromText, toDoc } from '../src/text';
import { isTrace } from '../src/trace';

function mk(over: Partial<ClassifyInput> & { text?: string; html?: string } = {}): ClassifyInput {
  const title = over.title ?? 'Software Engineer';
  const doc = over.doc ?? (over.html !== undefined ? toDoc(over.html) : docFromText(over.text ?? ''));
  const { text: _t, html: _h, ...rest } = over;
  return {
    title,
    titleNorm: canonicalTitle(title).norm,
    department: null,
    team: null,
    employmentRaw: null,
    workplaceRaw: null,
    isRemoteHint: null,
    locationsRaw: [],
    doc,
    yearsMin: null,
    ...rest,
  };
}
const level = (title: string, yearsMin: number | null = null) => classifyLevel(mk({ title, yearsMin })).value;
const family = (title: string, extra: Partial<ClassifyInput> = {}) => classifyRoleFamily(mk({ title, ...extra })).value;

describe('classifyLevel: title rules', () => {
  it.each([
    ['Software Engineering Intern', 'intern'],
    ['Summer Internship - Data', 'intern'],
    ['Co-op Software Developer', 'intern'],
    ['New Grad Software Engineer', 'entry'],
    ['Graduate Software Engineer', 'entry'],
    ['Junior Developer', 'entry'],
    ['Jr. Analyst', 'entry'],
    ['Associate Product Manager', 'entry'],
    ['Software Engineer I', 'entry'],
    ['Software Engineer 1', 'entry'],
    ['Entry-Level Consultant', 'entry'],
    ['Software Engineer II', 'mid'],
    ['Analyst 2', 'mid'],
    ['Senior Software Engineer', 'senior'],
    ['Sr. Software Engineer', 'senior'],
    ['Software Engineer III', 'senior'],
    ['Staff Software Engineer', 'lead'],
    ['Principal Engineer', 'lead'],
    ['Member of Technical Staff', null],
    ['Senior Member of Technical Staff', 'senior'],
    ['Executive Assistant to Head of Engineering', null],
    ['Strategy & Operations, Office of the CEO', null],
    ['Tech Lead, Payments', 'lead'],
    ['Head of Design', 'lead'],
    ['Director of Engineering', 'executive'],
    ['VP, Sales', 'executive'],
    ['Vice President of Marketing', 'executive'],
    ['Chief Technology Officer', 'executive'],
    ['CFO', 'executive'],
    ['Associate Director, Strategy', 'executive'],
    ['Senior Director, Finance', 'executive'],
  ] as const)('%s -> %s', (t, expected) => {
    expect(level(t)).toBe(expected);
  });
  it('does not treat Account Executive or Executive Assistant as executive', () => {
    expect(level('Account Executive, Corporate')).not.toBe('executive');
    expect(level('Account Executive, Corporate')).toBeNull();
    expect(level('Executive Assistant to the CEO')).not.toBe('executive');
    expect(level('Senior Account Executive')).toBe('senior');
    const r = classifyLevel(mk({ title: 'Executive Assistant, VP Support' }));
    expect(r.value).toBeNull();
    expect(r.trace.steps.some((s) => s.ruleId === 'level.exclude.executive_assistant' && s.op === 'reject')).toBe(true);
  });
  it('does not read "Associate Director" as entry', () => {
    expect(level('Associate Director')).toBe('executive');
    const r = classifyLevel(mk({ title: 'Associate Director' }));
    expect(r.trace.steps.find((s) => s.op === 'classify')!.ruleId).toBe('level.title.executive');
  });
  it('resolves conflicts by priority and records a select step', () => {
    const r = classifyLevel(mk({ title: 'Senior Staff Engineer' }));
    expect(r.value).toBe('lead');
    const sel = r.trace.steps.find((s) => s.op === 'select')!;
    expect(sel.ruleId).toBe('level.select.title_conflict');
    expect(sel.inputs.candidates).toEqual(['lead', 'senior']);
    expect(level('Senior Software Engineer II')).toBe('senior');
    expect(level('Senior Data Science Intern')).toBe('intern');
  });
  it('does not match words that merely contain a level word', () => {
    expect(level('Internal Tools Engineer')).toBeNull();
    expect(level('International Sales Rep')).toBeNull();
    expect(level('Seniority Analyst')).toBeNull();
    expect(level('Graduated Pricing Analyst')).toBeNull();
  });
  it('quotes the exact title slice as evidence', () => {
    const r = classifyLevel(mk({ title: 'Staff Software Engineer' }));
    expect(r.evidence).toHaveLength(1);
    const e = r.evidence[0]!;
    expect(e.source).toBe('title');
    expect('Staff Software Engineer'.slice(e.start, e.end)).toBe(e.quote);
    expect(e.quote.toLowerCase()).toBe('staff');
  });
});

describe('classifyLevel: years band fallback', () => {
  it.each([
    [0, 'entry'],
    [1, 'entry'],
    [2, 'mid'],
    [4, 'mid'],
    [5, 'senior'],
    [7, 'senior'],
    [8, 'lead'],
    [15, 'lead'],
  ] as const)('%i years -> %s', (y, expected) => {
    const r = classifyLevel(mk({ title: 'Software Engineer', yearsMin: y }));
    expect(r.value).toBe(expected);
    expect(r.trace.steps[0]!.ruleId).toBe('level.years_band');
    expect(r.evidence).toEqual([]);
  });
  it('title beats years', () => {
    expect(level('Junior Developer', 10)).toBe('entry');
  });
  it('returns null with no evidence', () => {
    const r = classifyLevel(mk({ title: 'Software Engineer' }));
    expect(r.value).toBeNull();
    expect(r.trace.outcome).toBe('null');
    expect(r.trace.steps[0]!.ruleId).toBe('level.none');
  });
});

describe('level helpers', () => {
  it('levelDistance is the ordinal gap', () => {
    expect(levelDistance('entry', 'entry')).toBe(0);
    expect(levelDistance('entry', 'mid')).toBe(1);
    expect(levelDistance('mid', 'entry')).toBe(1);
    expect(levelDistance('intern', 'executive')).toBe(5);
    expect(LEVELS).toEqual(['intern', 'entry', 'mid', 'senior', 'lead', 'executive']);
  });
  it('toPublicLevel maps to the recon vocabulary', () => {
    const m: Record<Level, string> = { intern: 'intern', entry: 'entry', mid: 'mid', senior: 'experienced', lead: 'experienced', executive: 'experienced' };
    for (const l of LEVELS) expect(toPublicLevel(l)).toBe(m[l]);
  });
});

describe('classifyWorkplace', () => {
  it('Ashby benchling: structured Hybrid beats the isRemote hint', () => {
    const r = classifyWorkplace(mk({ workplaceRaw: 'Hybrid', isRemoteHint: true }));
    expect(r.value).toBe('hybrid');
    expect(r.trace.steps.some((s) => s.ruleId === 'workplace.remote_hint_ignored')).toBe(true);
    expect(r.trace.steps.at(-1)!.ruleId).toBe('workplace.structured');
    expect(r.evidence[0]).toMatchObject({ source: 'workplace_raw', quote: 'Hybrid' });
  });
  it.each([
    ['Remote', 'remote'],
    ['remote', 'remote'],
    ['OnSite', 'onsite'],
    ['onsite', 'onsite'],
    ['On-site', 'onsite'],
    ['Hybrid', 'hybrid'],
    ['hybrid', 'hybrid'],
  ] as const)('structured %s -> %s', (raw, expected) => {
    expect(classifyWorkplace(mk({ workplaceRaw: raw })).value).toBe(expected);
  });
  it('Lever unspecified gives no signal', () => {
    const r = classifyWorkplace(mk({ workplaceRaw: 'unspecified' }));
    expect(r.value).toBeNull();
    expect(r.trace.steps[0]!.ruleId).toBe('workplace.structured_no_signal');
    expect(classifyWorkplace(mk({ workplaceRaw: 'unspecified', locationsRaw: ['Remote - US'] })).value).toBe('remote');
  });
  it('records unknown structured values and falls through', () => {
    const r = classifyWorkplace(mk({ workplaceRaw: 'Flexible-ish', text: 'This is a fully remote role.' }));
    expect(r.value).toBe('remote');
    expect(r.trace.steps[0]!.ruleId).toBe('workplace.structured_unknown');
  });
  it('lever cred: onsite', () => {
    expect(classifyWorkplace(mk({ workplaceRaw: 'onsite', locationsRaw: ['bengaluru'] })).value).toBe('onsite');
  });
  it('location strings: remote', () => {
    for (const loc of ['Remote - US', 'United States (Remote)', 'Remote', 'US - Remote', 'Remote, Canada']) {
      const r = classifyWorkplace(mk({ locationsRaw: [loc] }));
      expect(r.value, loc).toBe('remote');
      expect(r.trace.steps.at(-1)!.ruleId).toBe('workplace.location_remote');
      const e = r.evidence[0]!;
      expect(e).toMatchObject({ source: 'location', index: 0 });
      expect(loc.slice(e.start, e.end)).toBe(e.quote);
    }
  });
  it('airtable greenhouse locations: Remote - US plus offices is remote', () => {
    expect(classifyWorkplace(mk({ locationsRaw: ['Remote - US', 'Austin, Texas, United States'] })).value).toBe('remote');
    expect(classifyWorkplace(mk({ locationsRaw: ['Austin, Texas, United States'] })).value).toBeNull();
  });
  it('location mode words', () => {
    expect(classifyWorkplace(mk({ locationsRaw: ['Hybrid'] })).value).toBe('hybrid');
    expect(classifyWorkplace(mk({ locationsRaw: ['In-Office'] })).value).toBe('onsite');
    expect(classifyWorkplace(mk({ locationsRaw: ['Hybrid - Remote'] })).value).toBe('hybrid');
    expect(classifyWorkplace(mk({ locationsRaw: ['New York, NY (On-site)'] })).value).toBe('onsite');
  });
  it('description phrases', () => {
    const cases: [string, string][] = [
      ['We are a fully remote company.', 'remote'],
      ['This is a 100% remote position.', 'remote'],
      ['We are remote-first.', 'remote'],
      ['This is a hybrid role based in Austin.', 'hybrid'],
      ['You will work three days a week in the office.', 'hybrid'],
      ['We work 3 days per week in our office.', 'hybrid'],
      ['This role is in-office.', 'onsite'],
      ['On-site position, five days a week in the office.', 'onsite'],
      ['Structured hybrid working arrangement: 3 days in our Sydney office, 2 days working from home.', 'hybrid'],
      ['Onsite 4 days/week in San Francisco, CA', 'hybrid'],
      ['We are an in-office company.', 'onsite'],
      ['This role requires an in-office presence.', 'onsite'],
    ];
    for (const [text, expected] of cases) {
      const r = classifyWorkplace(mk({ text }));
      expect(r.value, text).toBe(expected);
      expect(r.trace.steps.at(-1)!.ruleId).toMatch(/^workplace\.description_phrase\./);
      const e = r.evidence[0]!;
      expect(text.slice(e.start, e.end)).toBe(e.quote);
    }
  });
  it('does not read stray remote words in a description', () => {
    expect(classifyWorkplace(mk({ text: 'Experience with remote teams and remote debugging.' })).value).toBeNull();
    expect(classifyWorkplace(mk({ text: 'Our hybrid cloud platform.' })).value).toBeNull();
    expect(classifyWorkplace(mk({ text: 'We will schedule an onsite in our office. There is no in-office qualification.' })).value).toBeNull();
  });
  it('first description phrase wins when several appear', () => {
    const r = classifyWorkplace(mk({ text: 'This is a hybrid role. Some teams are fully remote.' }));
    expect(r.value).toBe('hybrid');
  });
  it('records losing signals in a select step', () => {
    const r = classifyWorkplace(mk({ workplaceRaw: 'OnSite', locationsRaw: ['Remote - US'] }));
    expect(r.value).toBe('onsite');
    const sel = r.trace.steps.find((s) => s.op === 'select')!;
    expect(sel.ruleId).toBe('workplace.select');
    expect(sel.inputs.losers).toEqual([{ rule: 'workplace.location_remote', value: 'remote' }]);
  });
  it('isRemote hint alone gives remote at 0.6', () => {
    const r = classifyWorkplace(mk({ isRemoteHint: true }));
    expect(r.value).toBe('remote');
    expect(r.trace.steps[0]).toMatchObject({ ruleId: 'workplace.remote_hint', inputs: { confidence: 0.6 } });
    expect(r.evidence[0]!.source).toBe('remote_hint');
    expect(classifyWorkplace(mk({ isRemoteHint: false })).value).toBeNull();
  });
  it('defaults to null with a trace', () => {
    const r = classifyWorkplace(mk());
    expect(r.value).toBeNull();
    expect(r.trace.outcome).toBe('null');
    expect(isTrace(r.trace)).toBe(true);
  });
});

describe('classifyEmployment', () => {
  it.each([
    ['FullTime', 'fulltime'],
    ['full time', 'fulltime'],
    ['Full-time', 'fulltime'],
    ['Full-Time', 'fulltime'],
    ['Full Time Employee', 'fulltime'],
    ['Permanent', 'fulltime'],
    ['On-roll', 'fulltime'],
    ['PartTime', 'parttime'],
    ['Part-time', 'parttime'],
    ['Contract', 'contract'],
    ['Temporary', 'contract'],
    ['Contractor', 'contract'],
    ['Freelance', 'contract'],
    ['Intern', 'intern'],
    ['Internship', 'intern'],
  ] as const)('structured %s -> %s', (raw, expected) => {
    const r = classifyEmployment(mk({ employmentRaw: raw }));
    expect(r.value).toBe(expected);
    expect(r.trace.steps.at(-1)!.ruleId).toBe('employment.structured');
    expect(r.evidence[0]).toMatchObject({ source: 'employment_raw', quote: raw });
  });
  it('a title intern overrides structured FullTime', () => {
    const r = classifyEmployment(mk({ title: 'Software Engineer Intern', employmentRaw: 'FullTime' }));
    expect(r.value).toBe('intern');
    expect(r.trace.steps.map((s) => s.ruleId)).toEqual(['employment.select', 'employment.title_intern']);
    expect(r.evidence[0]).toMatchObject({ source: 'title', quote: 'Intern' });
  });
  it('title intern without a structured value, and with Intern structured', () => {
    expect(classifyEmployment(mk({ title: 'Marketing Internship' })).value).toBe('intern');
    expect(classifyEmployment(mk({ title: 'Data Intern', employmentRaw: 'Intern' })).trace.steps.map((s) => s.ruleId)).toEqual(['employment.title_intern']);
  });
  it('does not take Internal or International for intern', () => {
    expect(classifyEmployment(mk({ title: 'Internal Tools Engineer', employmentRaw: 'FullTime' })).value).toBe('fulltime');
  });
  it('unknown structured values fall through to title and description', () => {
    expect(classifyEmployment(mk({ employmentRaw: 'International EOR' })).value).toBeNull();
    expect(classifyEmployment(mk({ employmentRaw: 'Binance Accelerator Program', title: 'Contract Designer' })).value).toBe('contract');
    const r = classifyEmployment(mk({ employmentRaw: 'International EOR', text: 'This is a full-time position.' }));
    expect(r.value).toBe('fulltime');
    expect(r.trace.steps[0]!.ruleId).toBe('employment.structured_unknown');
  });
  it('title words', () => {
    expect(classifyEmployment(mk({ title: 'Freelance Illustrator' })).value).toBe('contract');
    expect(classifyEmployment(mk({ title: 'Part-time Barista' })).value).toBe('parttime');
  });
  it('description phrases', () => {
    const cases: [string, string][] = [
      ['This is a full-time position based in Austin.', 'fulltime'],
      ['This is a 6-month contract role.', 'contract'],
      ['This is a part-time position.', 'parttime'],
      ['This is a summer internship.', 'intern'],
      ['Permanent position with benefits.', 'fulltime'],
    ];
    for (const [text, expected] of cases) {
      const r = classifyEmployment(mk({ text }));
      expect(r.value, text).toBe(expected);
      expect(r.trace.steps.at(-1)!.ruleId).toBe('employment.description_phrase');
    }
  });
  it('first description phrase in document order wins', () => {
    expect(classifyEmployment(mk({ text: 'This is a part-time position. Some roles are full-time positions.' })).value).toBe('parttime');
  });
  it('defaults to null', () => {
    const r = classifyEmployment(mk());
    expect(r.value).toBeNull();
    expect(r.trace.outcome).toBe('null');
  });
});

describe('classifyRoleFamily: lexicon', () => {
  it.each([
    ['Engineering Manager, Platform', 'engineering-manager'],
    ['Director of Engineering', 'engineering-manager'],
    ['VP Engineering', 'engineering-manager'],
    ['Software Engineer', 'software-engineer-general'],
    ['Senior Staff Software Engineer', 'software-engineer-general'],
    ['Member of Technical Staff', 'software-engineer-general'],
    ['Frontend Engineer', 'software-engineer-frontend'],
    ['Front-End Developer', 'software-engineer-frontend'],
    ['Backend Engineer', 'software-engineer-backend'],
    ['Java Developer', 'software-engineer-backend'],
    ['Full Stack Engineer', 'software-engineer-fullstack'],
    ['Full-Stack Developer', 'software-engineer-fullstack'],
    ['iOS Engineer', 'software-engineer-mobile'],
    ['Android Developer', 'software-engineer-mobile'],
    ['Site Reliability Engineer', 'infrastructure-sre'],
    ['DevOps Engineer', 'infrastructure-sre'],
    ['Platform Engineer', 'infrastructure-sre'],
    ['Security Engineer', 'security-engineer'],
    ['Application Security Analyst', 'security-engineer'],
    ['Data Engineer', 'data-engineer'],
    ['Analytics Engineer', 'data-engineer'],
    ['Data Scientist', 'data-scientist'],
    ['Data Analyst', 'data-analyst'],
    ['Business Intelligence Analyst', 'data-analyst'],
    ['Machine Learning Engineer', 'ml-engineer'],
    ['Applied AI Engineer', 'ml-engineer'],
    ['Research Scientist', 'research-scientist'],
    ['Research Engineer', 'research-scientist'],
    ['QA Engineer', 'qa-test-engineer'],
    ['SDET', 'qa-test-engineer'],
    ['Embedded Software Engineer', 'hardware-embedded'],
    ['FPGA Engineer', 'hardware-embedded'],
    ['Solutions Architect', 'solutions-engineer'],
    ['Sales Engineer', 'solutions-engineer'],
    ['Forward Deployed Engineer', 'solutions-engineer'],
    ['Product Manager', 'product-manager'],
    ['Group Product Manager', 'product-manager'],
    ['Head of Product', 'product-manager'],
    ['Product Designer', 'design'],
    ['UX Researcher', 'design'],
    ['Technical Program Manager', 'program-manager'],
    ['Project Manager', 'program-manager'],
    ['Account Executive, Corporate', 'sales'],
    ['Sales Development Representative', 'sales'],
    ['Enterprise Account Executive', 'sales'],
    ['Customer Success Manager', 'customer-success'],
    ['Technical Support Engineer', 'customer-success'],
    ['Product Marketing Manager', 'marketing'],
    ['Content Marketing Lead', 'marketing'],
    ['Growth Marketing Manager', 'marketing'],
    ['Operations Manager', 'operations-strategy'],
    ['Chief of Staff', 'operations-strategy'],
    ['Senior Accountant', 'finance'],
    ['FP&A Analyst', 'finance'],
    ['Corporate Counsel', 'legal'],
    ['Paralegal', 'legal'],
    ['Technical Recruiter', 'people-recruiting'],
    ['People Operations Partner', 'people-recruiting'],
    ['IT Support Specialist', 'it-corporate-systems'],
    ['Salesforce Administrator', 'it-corporate-systems'],
  ] as const)('%s -> %s', (t, expected) => {
    expect(family(t)).toBe(expected);
  });
  it('puts specific rules before generic ones', () => {
    expect(family('Engineering Manager')).toBe('engineering-manager');
    expect(family('Engineering Manager')).not.toBe('software-engineer-general');
    expect(family('Product Marketing Manager')).toBe('marketing');
    expect(family('Product Designer')).toBe('design');
    expect(family('Senior Machine Learning Engineer')).toBe('ml-engineer');
    expect(family('Security Software Engineer')).toBe('security-engineer');
  });
  it('lever cred: department business development & partnerships gives sales', () => {
    const r = classifyRoleFamily(mk({ title: 'Analyst', department: 'business development & partnerships' }));
    expect(r.value).toBe('sales');
    const step = r.trace.steps.at(-1)!;
    expect(step.ruleId).toBe('role.department');
    expect(r.evidence[0]).toMatchObject({ source: 'department', quote: 'business development & partnerships' });
    expect(family('Business Development & Partnerships')).toBe('sales');
  });
  it('lever product & growth department', () => {
    expect(classifyRoleFamily(mk({ title: 'Associate', department: 'product & growth' })).value).toBe('product-manager');
  });
  it('uses the team when the department is empty', () => {
    const r = classifyRoleFamily(mk({ title: 'Specialist', team: 'Customer Success' }));
    expect(r.value).toBe('customer-success');
    expect(r.evidence[0]!.source).toBe('team');
  });
  it('title beats department', () => {
    expect(family('Account Executive', { department: 'Engineering' })).toBe('sales');
  });
  it('quotes a title slice as evidence', () => {
    const r = classifyRoleFamily(mk({ title: 'Senior Frontend Engineer' }));
    const e = r.evidence[0]!;
    expect(e.source).toBe('title');
    expect('Senior Frontend Engineer'.slice(e.start, e.end)).toBe(e.quote);
  });
  it('leaves a bare leadership word unassigned instead of guessing', () => {
    for (const t of ['Director', 'Manager', 'Associate', 'Specialist', 'Lead']) {
      const r = classifyRoleFamily(mk({ title: t }));
      expect(r.value, t).toBeNull();
      expect(r.trace.outcome).toBe('null');
    }
  });
  it('uses the skill profile at confidence 0.5 only as a last resort', () => {
    const doc = docFromText('You know Python, TypeScript, React and Django well.');
    const skills = extractSkills(doc);
    const r = classifyRoleFamily(mk({ title: 'Fellow', doc }), skills);
    expect(r.value).toBe('software-engineer-general');
    expect(r.trace.steps.at(-1)).toMatchObject({ ruleId: 'role.skill_profile', inputs: { confidence: 0.5 } });
    const infra = extractSkills(docFromText('Run PostgreSQL, MySQL, Redis, AWS and Kubernetes at scale.'));
    expect(classifyRoleFamily(mk({ title: 'Fellow' }), infra).value).toBe('infrastructure-sre');
    expect(classifyRoleFamily(mk({ title: 'Fellow' }), extractSkills(docFromText('Python only'))).value).toBeNull();
  });
  it('returns null (no "other" slug) when nothing matches', () => {
    const r = classifyRoleFamily(mk({ title: 'Brex Rotational Program' }));
    expect(r.value).toBeNull();
    expect(r.trace.outcome).toBe('null');
    expect(ROLE_FAMILIES).not.toContain('other');
  });
});

describe('role-families.json', () => {
  const d = rolesData as unknown as { titleRules: { id: string; family: string; pattern: string }[]; departmentRules: { family: string; pattern: string }[] };
  it('uses only known families, valid regexes and unique rule ids', () => {
    const fam = new Set<string>(ROLE_FAMILIES);
    for (const r of [...d.titleRules, ...d.departmentRules]) {
      expect(fam.has(r.family), r.family).toBe(true);
      expect(() => new RegExp(r.pattern, 'i')).not.toThrow();
    }
    expect(new Set(d.titleRules.map((r) => r.id)).size).toBe(d.titleRules.length);
  });
  it('has 27 families and every one can be produced by the lexicon or departments', () => {
    expect(ROLE_FAMILIES).toHaveLength(27);
    const produced = new Set([...d.titleRules, ...d.departmentRules].map((r) => r.family));
    for (const f of ROLE_FAMILIES) expect(produced.has(f), f).toBe(true);
  });
});

describe('detectVisa', () => {
  const v = (text: string) => detectVisa(docFromText(text));
  it.each([
    'We are unable to sponsor visas for this position.',
    'We are not able to sponsor work visas.',
    'We cannot sponsor candidates at this time.',
    "We can't sponsor visas.",
    "We won't sponsor employment visas.",
    'We will not sponsor a visa.',
    'The company does not offer visa sponsorship.',
    'We do not provide sponsorship for this role.',
    "We don't provide employment visa sponsorship.",
    'Visa sponsorship is not available.',
    'Sponsorship is not available for this position.',
    'No visa sponsorship is available.',
    'No sponsorship.',
    'You must be authorized to work in the US without current or future sponsorship.',
    'Candidates must be eligible to work in the United States without visa sponsorship.',
    'Applicants must not require sponsorship now or in the future.',
  ])('negative: %s', (text) => {
    const r = v(text);
    expect(r.value, text).toBe('no');
    expect(r.trace.steps.some((s) => s.ruleId === 'visa.negative')).toBe(true);
  });
  it.each([
    'Visa sponsorship is available for the right candidate.',
    'We will sponsor work visas.',
    'We can sponsor H-1B visas.',
    'We do sponsor visas.',
    'We offer visa sponsorship and relocation.',
    'We offer immigration sponsorship.',
    'We are open to sponsoring candidates.',
    'H-1B transfers are welcome.',
    'We offer relocation and visa support.',
  ])('positive: %s', (text) => {
    const r = v(text);
    expect(r.value, text).toBe('yes');
    expect(r.trace.steps.some((s) => s.ruleId === 'visa.positive')).toBe(true);
  });
  it.each([
    'We may sponsor visas for exceptional candidates.',
    'Sponsorship may be available depending on the role.',
    'Visa sponsorship is considered on a case-by-case basis.',
    'We might sponsor the right person.',
  ])('hedged: %s', (text) => {
    const r = v(text);
    expect(r.value, text).toBe('unknown');
    expect(r.trace.steps.some((s) => s.ruleId === 'visa.hedged')).toBe(true);
  });
  it('ignores interrogatives', () => {
    const r = v('Will you now or in the future require sponsorship?\nDo you require visa sponsorship to work here?');
    expect(r.value).toBe('unknown');
    expect(r.trace.steps.filter((s) => s.ruleId === 'visa.question_ignored')).toHaveLength(2);
  });
  it('defaults to unknown', () => {
    const r = v('Build great software with us.');
    expect(r.value).toBe('unknown');
    expect(r.trace.steps.map((s) => s.ruleId)).toEqual(['visa.none']);
    expect(v('').value).toBe('unknown');
  });
  it('negative beats positive and records the conflict', () => {
    const r = v('We offer visa sponsorship for some roles.\nFor this role we are unable to sponsor.');
    expect(r.value).toBe('no');
    expect(r.trace.steps.some((s) => s.ruleId === 'visa.conflict_negative_wins')).toBe(true);
  });
  it('reclassifies a positive phrase that has a negation just before it', () => {
    const r = v('We do not claim that visa sponsorship is available.');
    expect(r.value).toBe('no');
  });
  it('does not call a hedge positive when a definite statement exists elsewhere', () => {
    expect(v('We may sponsor visas. We will sponsor work visas for this role.').value).toBe('yes');
  });
  it('quotes evidence from the description', () => {
    const text = 'About the role.\nWe are unable to sponsor visas.';
    const r = v(text);
    expect(r.evidence).toHaveLength(1);
    const e = r.evidence[0]!;
    expect(text.slice(e.start, e.end)).toBe(e.quote);
    expect(e.source).toBe('description');
    expect(isTrace(r.trace)).toBe(true);
  });
  it('works on html input through toDoc', () => {
    const r = detectVisa(toDoc('<p>Unfortunately, we are unable to sponsor <b>work visas</b> at this time.</p>'));
    expect(r.value).toBe('no');
  });
  it('reads curly apostrophes like straight ones', () => {
    for (const t of ['We can\u2019t sponsor visas.', 'We won\u2019t sponsor work visas.', 'We don\u2019t offer visa sponsorship.', 'We don\u2019t provide sponsorship.']) {
      const r = v(t);
      expect(r.value, t).toBe('no');
      expect(r.evidence[0]!.quote.length).toBeGreaterThan(0);
      expect(t.slice(r.evidence[0]!.start, r.evidence[0]!.end)).toBe(r.evidence[0]!.quote);
    }
    expect(v('Sponsorship isn\u2019t available, and we can\u2019t sponsor visas.').value).toBe('no');
  });
  it('needs visa context for a bare "will sponsor"', () => {
    expect(v('Elastic will sponsor the process where required.').value).toBe('unknown');
    expect(v('We will sponsor the conference.').value).toBe('unknown');
    expect(v('We will sponsor your work visa.').value).toBe('yes');
    expect(v('We do sponsor and take over sponsorship of employment visas for this role.').value).toBe('yes');
  });
  it('does not fire on unrelated uses of sponsor', () => {
    expect(v('We sponsor local football teams and community events.').value).toBe('unknown');
  });
});

describe('traces and determinism', () => {
  it('every classifier trace is valid, JSON-safe and stable', () => {
    const i = mk({
      title: 'Senior Software Engineer',
      department: 'Engineering',
      employmentRaw: 'FullTime',
      workplaceRaw: 'Hybrid',
      isRemoteHint: true,
      locationsRaw: ['Austin, Texas, United States'],
      text: 'This is a hybrid role. We cannot sponsor visas.',
      yearsMin: 5,
    });
    for (const r of [classifyLevel(i), classifyWorkplace(i), classifyEmployment(i), classifyRoleFamily(i), detectVisa(i.doc)]) {
      expect(isTrace(r.trace)).toBe(true);
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
      expect(JSON.stringify(r)).toBe(JSON.stringify(
        r === undefined ? null : (r.trace.subject === 'level' ? classifyLevel(i) : r.trace.subject === 'workplace' ? classifyWorkplace(i) : r.trace.subject === 'employment' ? classifyEmployment(i) : r.trace.subject === 'role_family' ? classifyRoleFamily(i) : detectVisa(i.doc)),
      ));
    }
  });
});
