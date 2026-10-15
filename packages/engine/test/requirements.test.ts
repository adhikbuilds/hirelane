import { describe, expect, it } from 'vitest';
import { isTrace } from '../src/trace';
import { toDoc, docFromText } from '../src/text';
import { extractRequirements, parseYearsMin, type Requirement } from '../src/requirements';

const items = (r: { requirements: Requirement[] }) => r.requirements.map((x) => [x.kind, x.text]);
const doc = (html: string) => toDoc(html);

describe('parseYearsMin', () => {
  const ok: [string, number][] = [
    ['5+ years of experience in Go', 5],
    ['At least 3 years of experience', 3],
    ['Minimum of two years working with data', 2],
    ['3-5 years of professional experience', 3],
    ['3–5 years of experience', 3],
    ['10- 15+ years of experience in an enterprise role', 10],
    ['1+ yr experience', 1],
    ['At least five years in a b2b customer facing technical role', 5],
    ['Min. 5 years of practice, ideally as a corporate attorney', 5],
    ['8+ years in wire harness design for aerospace or robotics', 8],
    ['2+ years experience developing Workday reporting', 2],
    ['minimum 12+ years of progressive leadership', 12],
    ['Seven years of hands-on experience', 7],
    ['fifteen years experience', 15],
    ['5 years’ experience', 5],
    ['6-8+ years of experience in Product Marketing', 6],
    ['4+ years client facing experience with a background in logistics', 4],
  ];
  it.each(ok)('%s -> %i', (text, years) => {
    const r = parseYearsMin(text);
    expect(r, text).not.toBeNull();
    expect(r!.years).toBe(years);
    expect(text.slice(r!.evidence.start, r!.evidence.end)).toBe(r!.evidence.quote);
    expect(r!.evidence.source).toBe('description');
  });
  const no = [
    '50 years of history',
    'the first database provider to IPO in over 20 years',
    'We are 20 years old',
    '6+ months of relevant academic coursework',
    'Bachelor degree',
    '',
    'ten thousand customers',
    'founded 15 years ago',
  ];
  it.each(no)('rejects %j', (text) => expect(parseYearsMin(text)).toBeNull());
  it('takes the first match in the span', () => {
    expect(parseYearsMin('7+ years of experience, including 5+ years in infrastructure')!.years).toBe(7);
  });
});

describe('sections and kinds', () => {
  it('splits requirements and nice-to-have and reads bullets as must/nice', () => {
    const d = doc('<h2>What you\'ll do</h2><ul><li>Build services</li></ul><h2>What you\'ll bring</h2><ul><li>3+ years of Go experience</li><li>Strong communication</li></ul><h2>Nice to have</h2><ul><li>Rust</li></ul>');
    const r = extractRequirements(d);
    expect(items(r)).toEqual([
      ['must', '3+ years of Go experience'],
      ['must', 'Strong communication'],
      ['nice', 'Rust'],
    ]);
    expect(r.sections.map((s) => s.kind)).toEqual(['responsibilities', 'requirements', 'nice']);
    expect(r.lowConfidence).toBe(false);
    expect(isTrace(r.trace)).toBe(true);
    expect(r.trace.subject).toBe('requirements');
  });
  it('spans slice the doc text exactly and ord is sequential', () => {
    const d = doc('<h2>Requirements</h2><ul><li>One thing</li><li>Another thing</li></ul>');
    const r = extractRequirements(d);
    r.requirements.forEach((q, i) => {
      expect(q.ord).toBe(i);
      expect(d.text.slice(q.spanStart, q.spanEnd)).toBe(q.text);
      expect(q.extractor).toBe('rule');
      expect(q.skillIds).toEqual([]);
    });
  });
  it('section bodies span up to the next heading of equal or higher rank', () => {
    const d = doc('<h2>Requirements</h2><ul><li>A</li></ul><h3>Nice to have</h3><ul><li>B</li></ul><h2>Benefits</h2><ul><li>C</li></ul>');
    const r = extractRequirements(d);
    const req = r.sections.find((s) => s.kind === 'requirements')!;
    expect(d.text.slice(req.heading.start, req.heading.end)).toBe('Requirements');
    expect(req.body.end).toBeGreaterThan(req.body.start);
    expect(r.requirements.map((q) => q.text)).toEqual(['A', 'B']);
    expect(r.sections.map((s) => s.kind)).toEqual(['requirements', 'nice', 'benefits']);
  });
  it.each([
    ['Requirements', 'requirements'],
    ['Qualifications', 'requirements'],
    ['Minimum qualifications', 'requirements'],
    ['Basic qualifications', 'requirements'],
    ["What you'll bring", 'requirements'],
    ['What You’ll Bring', 'requirements'],
    ["What we're looking for", 'requirements'],
    ['You have:', 'requirements'],
    ['You might be a fit if', 'requirements'],
    ['You may thrive in this role if you', 'requirements'],
    ['About you', 'requirements'],
    ['Who you are', 'requirements'],
    ['Must have', 'requirements'],
    ['Required qualifications', 'requirements'],
    ['What we look for', 'requirements'],
    ['Your background looks something like this', 'requirements'],
    ['Nice to have', 'nice'],
    ['Nice to haves', 'nice'],
    ['Bonus', 'nice'],
    ['Bonus points', 'nice'],
    ['Preferred', 'nice'],
    ['Preferred qualifications', 'nice'],
    ['Preferred skills and experience', 'nice'],
    ['Even better if you have', 'nice'],
    ['It would be great if', 'nice'],
    ['While it’s not required, it’s an added plus if you also have:', 'nice'],
    ['You may also have', 'nice'],
    ['What we prefer', 'nice'],
    ["What you'll do", 'responsibilities'],
    ['Responsibilities', 'responsibilities'],
    ['Key Responsibilities:', 'responsibilities'],
    ['In this role, you will', 'responsibilities'],
    ['The role', 'responsibilities'],
    ['Benefits', 'benefits'],
    ['Perks & Benefits', 'benefits'],
    ["What we offer", 'benefits'],
    ['What you will have at Harness', 'benefits'],
    ['Compensation', 'compensation'],
    ['Pay Transparency', 'compensation'],
    ['Salary Range', 'compensation'],
    ['About us', 'about'],
    ['About the company', 'about'],
    ['Our values', 'other'],
    ['Interviewing with Acme', 'other'],
  ])('heading %j -> %s', (heading, kind) => {
    const d = doc(`<h2>${heading}</h2><ul><li>Something to do</li></ul>`);
    const r = extractRequirements(d);
    expect(r.sections[0]!.kind).toBe(kind);
    expect(r.sections[0]!.ruleId).toMatch(/^req\.section\./);
    if (kind === 'requirements') expect(items(r)).toEqual([['must', 'Something to do']]);
    else if (kind === 'nice') expect(items(r)).toEqual([['nice', 'Something to do']]);
    else expect(r.requirements.filter((q) => q.section !== null)).toEqual([]);
  });
  it('classifies heading text from bold paragraph and colon-line headings too', () => {
    const d = doc('<p><strong>Requirements</strong></p><ul><li>Python</li></ul><p>Nice to have:</p><ul><li>Rust</li></ul>');
    expect(items(extractRequirements(d))).toEqual([['must', 'Python'], ['nice', 'Rust']]);
  });
  it('responsibilities, benefits, about and compensation never yield requirements', () => {
    const d = doc('<h2>Responsibilities</h2><ul><li>Own the roadmap</li></ul><h2>About us</h2><ul><li>We are great</li></ul><h2>Benefits</h2><ul><li>401(k) plan</li></ul><h2>Compensation</h2><ul><li>$100,000 base</li></ul><h2>Requirements</h2><ul><li>Python</li></ul>');
    expect(items(extractRequirements(d))).toEqual([['must', 'Python']]);
  });
  it('does not treat label-only bullets as requirements', () => {
    const d = doc('<h2>Requirements</h2><ul><li>Investment-Savvy:</li><li>Deep domain knowledge</li></ul>');
    expect(items(extractRequirements(d))).toEqual([['must', 'Deep domain knowledge']]);
  });
  it('uses paragraphs when a requirements section has no bullets', () => {
    const d = doc('<h2>Requirements</h2><p>Strong Python skills</p><p>Good communication</p>');
    expect(items(extractRequirements(d))).toEqual([['must', 'Strong Python skills'], ['must', 'Good communication']]);
  });
  it('nested sub-headings do not leak a previous section into the next', () => {
    const d = doc('<h2>Who you are</h2><h3>Minimum requirements</h3><ul><li>A</li></ul><h3>Preferred qualifications</h3><ul><li>B</li></ul>');
    expect(items(extractRequirements(d))).toEqual([['must', 'A'], ['nice', 'B']]);
  });
});

describe('must vs nice cues', () => {
  const kind = (bullet: string, heading = 'Requirements') => {
    const r = extractRequirements(doc(`<h2>${heading}</h2><ul><li>${bullet}</li></ul>`));
    return r.requirements[0]!;
  };
  it.each([
    'Experience with Kubernetes is a plus',
    'Familiarity with Terraform is a plus.',
    'A Master’s degree is preferred',
    'Understanding of Spark preferable',
    'Bonus: Experience with e-commerce',
    'Ideally, 12+ years of related experience',
    'Preferably someone who has post-sales experience',
    'Ability to obtain a clearance desired',
    'Nice to haves: Experience with Looker',
    'Experience with large-scale systems is a bonus',
    '(Bonus) Robotics expertise',
  ])('nice cue in a requirements section: %s', (b) => {
    const q = kind(b);
    expect(q.kind).toBe('nice');
    expect(q.ruleIds).toContain('req.kind.cue_nice');
  });
  it.each([
    'You must have a clean driving licence',
    'Bachelor’s degree required',
    'Minimum 6 years experience selling technology',
    'At least 3 years of Python',
  ])('must cue beats a nice section default: %s', (b) => {
    const q = kind(b, 'Nice to have');
    expect(q.kind).toBe('must');
    expect(q.ruleIds).toContain('req.kind.cue_must');
  });
  it('ignores a preferred inside parentheses', () => {
    const q = kind('Strong CAD skills (NX or CATIA preferred) for 3D modeling');
    expect(q.kind).toBe('must');
  });
  it('lets an explicit minimum beat a later ideally', () => {
    const q = kind('Min. 5 years of practice, ideally as a corporate attorney at a major firm');
    expect(q.kind).toBe('must');
    expect(q.ruleIds).toContain('req.kind.cue_conflict');
  });
  it('falls back to the section default and says so', () => {
    expect(kind('Strong communication skills').ruleIds).toContain('req.kind.section_default_must');
    expect(kind('Rust', 'Preferred qualifications').ruleIds).toContain('req.kind.section_default_nice');
  });
});

describe('years, category, confidence', () => {
  const one = (bullet: string) => extractRequirements(doc(`<h2>Requirements</h2><ul><li>${bullet}</li></ul>`)).requirements[0]!;
  it('extracts yearsMin as an integer and flags the rule', () => {
    const q = one('5+ years of experience in distributed systems');
    expect(q.yearsMin).toBe(5);
    expect(q.category).toBe('experience');
    expect(q.ruleIds).toEqual(expect.arrayContaining(['req.section_default_must'.replace('section_default_must', 'kind.section_default_must'), 'req.years.min', 'req.category.experience']));
  });
  it('rejects non-experience years', () => {
    expect(one('Our company has 50 years of history').yearsMin).toBeNull();
  });
  it.each([
    ['Must be authorized to work in the United States', 'authorization'],
    ['We cannot offer visa sponsorship', 'authorization'],
    ['Ability to obtain a security clearance', 'authorization'],
    ['Bachelor’s degree in Computer Science', 'education'],
    ['BS/MS in Computer Science, or a related field', 'education'],
    ['PhD in Machine Learning', 'education'],
    ['Fluent in German and English', 'language'],
    ['Bilingual in Spanish and English', 'language'],
    ['Based in Berlin, Germany', 'location'],
    ['Must reside in the EU', 'location'],
    ['Ability to work in-person in our NYC or SF office', 'location'],
    ['3+ years of experience as a TAM', 'experience'],
    ['Strong communication skills', 'other'],
  ])('category: %s -> %s', (b, cat) => expect(one(b).category).toBe(cat));
  it('authorization beats education which beats experience in the fixed order', () => {
    expect(one('5+ years experience and authorization to work in the US').category).toBe('authorization');
    expect(one('5+ years of experience with a Bachelor’s degree').category).toBe('education');
  });
  it('gives rule-extracted items confidence in (0,1] with a lower value for section defaults than for cues', () => {
    const a = one('Strong communication skills');
    const b = one('Bachelor’s degree required');
    for (const q of [a, b]) expect(q.confidence).toBeGreaterThan(0);
    expect(b.confidence).toBeGreaterThan(a.confidence);
    expect(b.confidence).toBeLessThanOrEqual(1);
  });
  it('uses an injected skill annotator to fill skillIds sorted and restricted to the span', () => {
    const d = doc('<h2>Requirements</h2><ul><li>Python and Go experience</li><li>Good communication</li></ul>');
    const annotate = (x: typeof d) => ({
      hits: [
        { id: 'python', evidence: [{ source: 'description' as const, start: x.text.indexOf('Python'), end: x.text.indexOf('Python') + 6, quote: 'Python' }] },
        { id: 'go', evidence: [{ source: 'description' as const, start: x.text.indexOf('Go'), end: x.text.indexOf('Go') + 2, quote: 'Go' }] },
        { id: 'outside', evidence: [{ source: 'description' as const, start: x.text.length + 5, end: x.text.length + 9, quote: 'zzzz' }] },
      ],
    });
    const r = extractRequirements(d, annotate);
    expect(r.requirements[0]!.skillIds).toEqual(['go', 'python']);
    expect(r.requirements[0]!.category).toBe('skill');
    expect(r.requirements[1]!.skillIds).toEqual([]);
  });
});

describe('no-section fallback and low confidence', () => {
  it('falls back to experience bullets at confidence 0.5 and flags lowConfidence', () => {
    const d = doc('<p>Join us!</p><ul><li>5+ years of Java</li><li>Experience with AWS</li><li>Free lunch</li></ul>');
    const r = extractRequirements(d);
    expect(r.lowConfidence).toBe(true);
    expect(items(r)).toEqual([['must', '5+ years of Java'], ['must', 'Experience with AWS']]);
    for (const q of r.requirements) {
      expect(q.section).toBeNull();
      expect(q.confidence).toBe(0.5);
      expect(q.ruleIds).toContain('req.fallback.experience_bullet');
    }
  });
  it('is low confidence with no must items even when a nice section exists', () => {
    const r = extractRequirements(doc('<h2>Nice to have</h2><ul><li>Rust</li></ul>'));
    expect(r.lowConfidence).toBe(true);
    expect(items(r)).toEqual([['nice', 'Rust']]);
  });
  it('handles empty and heading-only documents', () => {
    for (const d of [toDoc(null), toDoc(''), docFromText('')]) {
      const r = extractRequirements(d);
      expect(r.requirements).toEqual([]);
      expect(r.sections).toEqual([]);
      expect(r.lowConfidence).toBe(true);
      expect(isTrace(r.trace)).toBe(true);
    }
    expect(extractRequirements(doc('<h2>Requirements</h2>')).requirements).toEqual([]);
  });
  it('plain-text documents have no bullets, so they use the paragraph fallback only', () => {
    const r = extractRequirements(docFromText('We need 5+ years of experience.\nNothing else.'));
    expect(r.requirements.length).toBeLessThanOrEqual(2);
    expect(r.lowConfidence).toBe(true);
  });
});

describe('Greenhouse and Lever shapes', () => {
  it('reads a Greenhouse bold-paragraph layout with li > p', () => {
    const html = '<p><strong>What you\'ll do</strong></p><ul><li><p>Ship code</p></li></ul><p><strong>What you bring</strong></p><ul><li><p>5+ years in backend</p></li><li><p>Kubernetes is a plus</p></li></ul>';
    expect(items(extractRequirements(doc(html)))).toEqual([['must', '5+ years in backend'], ['nice', 'Kubernetes is a plus']]);
  });
  it('reads Lever lists rendered as h3 + li', () => {
    const html = '<div>intro</div><h3>What we expect</h3><li>Go</li><li>SQL</li><h3>Nice to have</h3><li>Rust</li>';
    const r = extractRequirements(doc(html));
    expect(r.requirements.map((q) => q.kind)).toEqual(['must', 'must', 'nice']);
  });
  it('does not take responsibilities bullets in an Airtable-style layout', () => {
    const r = extractRequirements(doc('<h2>What you\'ll do</h2><ul><li>Close deals</li><li>Run demos</li></ul>'));
    expect(r.requirements).toEqual([]);
    expect(r.sections[0]!.kind).toBe('responsibilities');
  });
});

describe('determinism and JSON safety', () => {
  it('is deterministic and survives a JSON round-trip', () => {
    const d = doc('<h2>Requirements</h2><ul><li>5+ years of Go</li></ul><h2>Bonus</h2><ul><li>Rust</li></ul>');
    const a = extractRequirements(d);
    expect(extractRequirements(d)).toStrictEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toStrictEqual(a);
  });
  it('truncates an oversized trace cleanly', () => {
    const lis = Array.from({ length: 120 }, (_, i) => `<li>Skill number ${i}</li>`).join('');
    const r = extractRequirements(doc(`<h2>Requirements</h2><ul>${lis}</ul>`));
    expect(r.requirements).toHaveLength(120);
    expect(r.trace.steps.length).toBeLessThanOrEqual(64);
    expect(isTrace(r.trace)).toBe(true);
  });
});
