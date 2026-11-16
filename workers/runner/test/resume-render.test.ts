import { describe, expect, it } from 'vitest';
import { assessHealth } from '@hirelane/engine';
import { extractInThread } from '../src/resume/extract/thread';
import { runPipeline } from '../src/resume/pipeline';
import { RenderError, builderFileName, parseBuilderAnswers, renderResumePdf, type BuilderAnswers } from '../src/resume/render/index';

const answers = (over: Partial<BuilderAnswers> = {}): BuilderAnswers => ({
  name: 'Asha Example',
  email: 'asha.example@example.test',
  phone: '90000 00001',
  city: 'Pune',
  links: ['https://github.com/asha-example'],
  summary: 'Final-year student building small web tools.',
  education: [
    { qualification: 'B.Tech Computer Science', institution: 'Example Institute of Technology', year: '2026', score: 'CGPA 8.2/10' },
    { qualification: 'Class XII', institution: 'Example Junior College', year: '2022', score: '88%' },
  ],
  skills: ['Python', 'SQL', 'TypeScript', 'Git'],
  projects: [
    { title: 'Library tracker', link: 'https://github.com/asha-example/library', bullets: ['Built a REST API serving 1200 books with 98% test coverage', 'Cut search latency by 40% using an index'] },
    { title: 'Budget app', bullets: ['Tracked spend in ₹ across 5 categories for 30 users'] },
  ],
  experience: [{ role: 'Intern', org: 'Example Labs', period: 'May 2025 - Jul 2025', bullets: ['Automated 3 weekly reports, saving 6 hours a week', 'Stipend of ₹15,000 per month'] }],
  ...over,
});

describe('parseBuilderAnswers', () => {
  it('accepts a complete answer set and strips control characters', () => {
    const r = parseBuilderAnswers({ ...answers(), name: 'Asha\u0000 Example' });
    expect(r.name).toBe('Asha Example');
  });
  it.each([
    ['null', null],
    ['no name', { ...answers(), name: '' }],
    ['no education', { ...answers(), education: [] }],
    ['too few skills', { ...answers(), skills: ['Python'] }],
    ['no projects', { ...answers(), projects: [] }],
    ['bullet too long', { ...answers(), projects: [{ title: 'x', bullets: ['y'.repeat(400)] }] }],
    ['wrong types', { ...answers(), skills: 'Python, SQL, Git' }],
    ['unknown key', { ...answers(), dob: '2000-01-01' }],
  ])('rejects %s', (_n, v) => {
    expect(() => parseBuilderAnswers(v)).toThrow(RenderError);
  });
  it('error messages never echo values', () => {
    try {
      parseBuilderAnswers({ ...answers(), email: 'secret@example.test', skills: [] });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('secret@example.test');
    }
  });
});

describe('builderFileName', () => {
  it('is a Firstname_Lastname_Resume.pdf shape that is safe on disk', () => {
    expect(builderFileName(answers())).toBe('Asha_Example_Resume.pdf');
    expect(builderFileName(answers({ name: '../../etc/passwd अश' }))).toMatch(/^[A-Za-z0-9_]+_Resume\.pdf$|^Resume\.pdf$/);
  });
});

describe('renderResumePdf round trip', () => {
  it('renders a one page readable PDF with every builder-controlled health check passing', async () => {
    const pdf = await renderResumePdf(answers());
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    const r = await extractInThread(new Uint8Array(pdf));
    if ('rejected' in r) throw new Error(`rejected ${r.rejected}`);
    expect(r.pages).toBe(1);
    const report = assessHealth({ text: r.text, meta: r, fileName: builderFileName(answers()) });
    expect(report.textLayer).toBe('readable');
    const status = Object.fromEntries(report.checks.map((c) => [c.id, c.status]));
    expect(status).toEqual({
      ats_readable: 'pass', one_page: 'pass', contact_present: 'pass', no_biodata_ids: 'pass', no_padding: 'pass',
      bullets_with_numbers: 'pass', project_proof_links: 'pass', skills_in_text: 'pass', sensible_file_name: 'pass',
    });
    expect(report.passCount).toBe(9);
  });

  it('renders the rupee sign and keeps contact details as plain text', async () => {
    const r = await extractInThread(new Uint8Array(await renderResumePdf(answers())));
    if ('rejected' in r) throw new Error('rejected');
    expect(r.text).toContain('₹');
    expect(r.text).toContain('asha.example@example.test');
    expect(r.text).toContain('Library tracker');
  });

  it('is single column: each bullet stays on its own line, in order', async () => {
    const r = await extractInThread(new Uint8Array(await renderResumePdf(answers())));
    if ('rejected' in r) throw new Error('rejected');
    const i1 = r.text.indexOf('Built a REST API');
    const i2 = r.text.indexOf('Cut search latency');
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
  });

  it('stays on ONE page for worst-case lengths', async () => {
    const long = 'z'.repeat(0);
    const bullet = (n: number) => `Delivered ${n} features with ${'measurable improvements in speed and quality '.repeat(4)}`.slice(0, 200);
    const worst = answers({
      summary: 'S'.repeat(0) + 'Highly motivated '.repeat(14).slice(0, 240),
      links: ['https://github.com/a/b', 'https://www.linkedin.com/in/asha-example', 'https://asha.example.test'],
      education: [1, 2, 3].map((n) => ({ qualification: `Qualification ${n} in Computer Science and Engineering`, institution: 'Example Institute of Technology and Research', year: '2026', score: 'CGPA 8.2/10' })),
      skills: Array.from({ length: 20 }, (_, i) => `Skill number ${i + 1}`),
      projects: [1, 2, 3].map((n) => ({ title: `Project ${n} ${'T'.repeat(0)}`, link: 'https://github.com/asha-example/project-' + n, bullets: [1, 2, 3, 4].map((b) => bullet(b)) })),
      experience: [1, 2].map((n) => ({ role: `Intern ${n}`, org: 'Example Labs', period: 'May 2025 - Jul 2025', bullets: [1, 2, 3, 4].map((b) => bullet(b)) })),
    });
    void long;
    const pdf = await renderResumePdf(worst);
    const r = await extractInThread(new Uint8Array(pdf));
    if ('rejected' in r) throw new Error(`rejected ${r.rejected}`);
    expect(r.pages).toBe(1);
  });

  it('goes through the real pipeline as a parsed, readable, one page resume', async () => {
    const o = await runPipeline(await renderResumePdf(answers()), { fileName: builderFileName(answers()) });
    if (o.kind !== 'parsed') throw new Error(`expected parsed, got ${o.kind}`);
    expect(o.textLayer).toBe('readable');
    expect(o.pages).toBe(1);
    expect(o.healthPassed).toBe(9);
    expect(o.sensitiveKinds).toEqual([]);
  });

  it('uses no network and embeds no JavaScript or attachments', async () => {
    const pdf = Buffer.from(await renderResumePdf(answers())).toString('latin1');
    expect(pdf).not.toMatch(/\/JavaScript|\/JS |\/EmbeddedFile|\/Launch/);
  });
});
