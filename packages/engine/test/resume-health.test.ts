import { describe, expect, it } from 'vitest';
import { assessHealth, checkFileName } from '../src/resume/health';
import type { HealthInput } from '../src/resume/health';
import type { ExtractMeta, HealthCheckId } from '../src/resume/types';

const meta = (over: Partial<ExtractMeta> = {}): ExtractMeta => ({
  kind: 'pdf',
  pages: 1,
  pageStats: [{ chars: 900, images: 0 }],
  imageCount: 0,
  encrypted: false,
  flags: { javascript: false, embeddedFiles: false, macros: false, externalRefs: false },
  producerFamily: 'test',
  ...over,
});

const GOOD = [
  'Test Student 01',
  'Email: student01@example.test | Phone: +91 90000 00001',
  '',
  'Education',
  'B.Tech CSE, Test University, 2022-2026, CGPA 8.5/10',
  '',
  'Skills',
  'Python, TypeScript, SQL, React, Docker',
  '',
  'Projects',
  'Job Tracker',
  '- Built a REST API serving 500 requests per minute',
  '- Cut build time by 35% with caching',
  'Code: https://github.com/test-student-01/job-tracker',
  '',
  'Internships',
  '- Wrote 12 unit tests per week for a payments module',
].join('\n');

const input = (over: Partial<HealthInput> = {}): HealthInput => ({ text: GOOD, meta: meta(), fileName: 'Test_Student_Resume.pdf', ...over });
const status = (i: HealthInput, id: HealthCheckId) => assessHealth(i).checks.find((c) => c.id === id)!.status;
const replace = (a: string, b: string) => GOOD.replace(a, b);
const drop = (...lines: string[]) => GOOD.split('\n').filter((l) => !lines.some((x) => l.includes(x))).join('\n');

describe('assessHealth: shape', () => {
  it('a good resume passes all 9, in the canonical set of ids', () => {
    const r = assessHealth(input());
    expect(r.total).toBe(9);
    expect(r.passCount).toBe(9);
    expect(r.summary).toBe('9 of 9 checks pass');
    expect(r.checks.map((c) => c.id).sort()).toEqual(
      ['ats_readable', 'bullets_with_numbers', 'contact_present', 'no_biodata_ids', 'no_padding', 'one_page', 'project_proof_links', 'sensible_file_name', 'skills_in_text'],
    );
    for (const c of r.checks) {
      expect(c.reason.length).toBeGreaterThan(0);
      expect(c.fix.length).toBeGreaterThan(0);
    }
  });
  it('lists failing checks first, then unknown, then passing; summary is "N of 9", no score out of 100', () => {
    const r = assessHealth(input({ text: drop('Skills', 'Python,'), fileName: 'IMG_2031.pdf' }));
    const order = r.checks.map((c) => c.status);
    const rank = { fail: 0, unknown: 1, pass: 2 } as const;
    expect([...order].sort((a, b) => rank[a] - rank[b])).toEqual(order);
    expect(r.passCount).toBe(order.filter((s) => s === 'pass').length);
    expect(r.summary).toBe(`${r.passCount} of 9 checks pass`);
    expect(JSON.stringify(r)).not.toMatch(/100|score/i);
  });
  it('is stable on null / empty text', () => {
    expect(() => assessHealth({ text: null as unknown as string, meta: meta({ pageStats: [] }), fileName: null })).not.toThrow();
  });
});

describe('ats_readable and the no-text-layer rule', () => {
  const other8 = (i: HealthInput) => assessHealth(i).checks.filter((c) => c.id !== 'ats_readable');
  it.each([
    ['image-only PDF', input({ text: '', meta: meta({ pageStats: [{ chars: 0, images: 1 }], imageCount: 1 }) })],
    ['whitespace only', input({ text: '  \n \t ', meta: meta({ pageStats: [{ chars: 0, images: 0 }] }) })],
    ['garbled private-use glyphs', input({ text: '\uE001\uE002\uE003'.repeat(40), meta: meta({ pageStats: [{ chars: 120, images: 0 }] }) })],
  ])('%s: ats_readable fails and the other 8 are unknown', (_n, i) => {
    expect(status(i, 'ats_readable')).toBe('fail');
    const rest = other8(i);
    expect(rest).toHaveLength(8);
    expect(rest.every((c) => c.status === 'unknown')).toBe(true);
    expect(assessHealth(i).passCount).toBe(0);
    expect(assessHealth(i).checks[0]!.id).toBe('ats_readable');
  });
  it.each([
    ['text PDF', input()],
    ['DOCX', input({ meta: meta({ kind: 'docx', pages: null, pageStats: [{ chars: 900, images: 0 }] }) })],
    ['two-page text PDF', input({ meta: meta({ pages: 2, pageStats: [{ chars: 500, images: 0 }, { chars: 400, images: 0 }] }) })],
  ])('passes: %s', (_n, i) => {
    expect(status(i, 'ats_readable')).toBe('pass');
  });
  it('partial text layer fails ats_readable but other checks still run', () => {
    const i = input({ meta: meta({ pages: 2, pageStats: [{ chars: 900, images: 0 }, { chars: 0, images: 1 }], imageCount: 1 }) });
    expect(status(i, 'ats_readable')).toBe('fail');
    expect(status(i, 'contact_present')).toBe('pass');
  });
});

describe('one_page', () => {
  it.each([
    ['1-page PDF', input()],
    ['1-page PDF other producer', input({ meta: meta({ producerFamily: 'word' }) })],
    ['1-page, 1 image', input({ meta: meta({ imageCount: 1, pageStats: [{ chars: 900, images: 1 }] }) })],
  ])('pass: %s', (_n, i) => expect(status(i, 'one_page')).toBe('pass'));
  it.each([
    ['2 pages', input({ meta: meta({ pages: 2, pageStats: [{ chars: 500, images: 0 }, { chars: 400, images: 0 }] }) })],
    ['3 pages', input({ meta: meta({ pages: 3, pageStats: [{ chars: 300, images: 0 }, { chars: 300, images: 0 }, { chars: 300, images: 0 }] }) })],
    ['2 pages, second short', input({ meta: meta({ pages: 2, pageStats: [{ chars: 800, images: 0 }, { chars: 60, images: 0 }] }) })],
  ])('fail: %s', (_n, i) => expect(status(i, 'one_page')).toBe('fail'));
  it.each([
    ['DOCX', input({ meta: meta({ kind: 'docx', pages: null }) })],
    ['DOCX even with many chars', input({ meta: meta({ kind: 'docx', pages: null, pageStats: [{ chars: 9000, images: 0 }] }) })],
    ['PDF with unknown page count', input({ meta: meta({ pages: null }) })],
  ])('unknown: %s', (_n, i) => expect(status(i, 'one_page')).toBe('unknown'));
});

describe('contact_present', () => {
  it.each([
    ['email and +91 phone', GOOD],
    ['email and plain 10-digit phone', replace('+91 90000 00001', '9000000002')],
    ['email and phone with dashes', replace('+91 90000 00001', '+91-90000-00003')],
  ])('pass: %s', (_n, text) => expect(status(input({ text }), 'contact_present')).toBe('pass'));
  it.each([
    ['no email', replace('student01@example.test', 'n/a')],
    ['no phone', replace('+91 90000 00001', 'n/a')],
    ['neither', drop('Email:')],
  ])('fail: %s', (_n, text) => expect(status(input({ text }), 'contact_present')).toBe('fail'));
  it('reason names what is missing but never echoes a value', () => {
    const c = assessHealth(input({ text: replace('+91 90000 00001', 'n/a') })).checks.find((x) => x.id === 'contact_present')!;
    expect(c.reason).toMatch(/phone/i);
    expect(JSON.stringify(c)).not.toMatch(/example\.test|90000/);
  });
});

describe('no_biodata_ids', () => {
  const add = (line: string) => GOOD + '\n' + line;
  it.each([
    ['clean resume', GOOD],
    ['a roll number and order number', add('Roll No: 2210045 ; Order 123456789012')],
    ['a masked-free GitHub id line', add('GitHub id: test-student-01')],
  ])('pass: %s', (_n, text) => expect(status(input({ text }), 'no_biodata_ids')).toBe('pass'));
  it.each([
    ['PAN', add('PAN: ABCPE1234F')],
    ['date of birth', add('Date of Birth: 12/03/2003')],
    ['marital status', add('Marital Status: Single')],
    ['religion', add('Religion: Hindu')],
    ["father's name", add("Father's Name: Test Parent")],
  ])('fail: %s', (_n, text) => {
    expect(status(input({ text }), 'no_biodata_ids')).toBe('fail');
  });
  it('never echoes the value', () => {
    const r = assessHealth(input({ text: add('PAN: ABCPE1234F\nDate of Birth: 12/03/2003') }));
    expect(JSON.stringify(r)).not.toMatch(/ABCPE|1234F|12\/03\/2003/);
  });
});

describe('no_padding', () => {
  const add = (line: string) => GOOD + '\n\n' + line;
  it.each([
    ['clean resume', GOOD],
    ['objective is fine', replace('Education', 'Objective\nBackend developer role.\n\nEducation')],
    ['achievements is fine', add('Achievements\n- Won 1 of 40 hackathon teams')],
  ])('pass: %s', (_n, text) => expect(status(input({ text }), 'no_padding')).toBe('pass'));
  it.each([
    ['declaration block', add('Declaration\nI hereby declare that the above is true.')],
    ['personal details block', add('Personal Details\nNationality: Indian')],
    ['declaration sentence inline', add('I hereby declare that all the above information is true to the best of my knowledge.')],
    ['hobbies block', add('Hobbies\nReading, cricket')],
  ])('fail: %s', (_n, text) => expect(status(input({ text }), 'no_padding')).toBe('fail'));
});

describe('bullets_with_numbers', () => {
  it.each([
    ['good resume', GOOD],
    ['unicode bullets', GOOD.replace(/^- /gm, '\u2022 ')],
    ['star bullets', GOOD.replace(/^- /gm, '* ')],
  ])('pass: %s', (_n, text) => expect(status(input({ text }), 'bullets_with_numbers')).toBe('pass'));
  it.each([
    ['bullets without numbers', replace('- Built a REST API serving 500 requests per minute', '- Built a REST API').replace('- Cut build time by 35% with caching', '- Improved build time').replace('- Wrote 12 unit tests per week for a payments module', '- Wrote unit tests')],
    ['no bullets at all', GOOD.replace(/^- /gm, '')],
    ['mostly non-numeric bullets', GOOD + '\n- Did things\n- Did more things\n- Helped team\n- Supported release'],
  ])('fail: %s', (_n, text) => expect(status(input({ text }), 'bullets_with_numbers')).toBe('fail'));
});

describe('project_proof_links', () => {
  it.each([
    ['github link in projects', GOOD],
    ['https link in projects', replace('https://github.com/test-student-01/job-tracker', 'https://jobtracker.example.test')],
    ['bare github.com path', replace('https://github.com/test-student-01/job-tracker', 'github.com/test-student-01/job-tracker')],
  ])('pass: %s', (_n, text) => expect(status(input({ text }), 'project_proof_links')).toBe('pass'));
  it.each([
    ['projects without any link', drop('Code:')],
    ['no projects section', drop('Projects', 'Job Tracker', 'Code:')],
    ['link only outside projects', drop('Code:').replace('Internships', 'Internships\nhttps://example.test/cert')],
  ])('fail: %s', (_n, text) => expect(status(input({ text }), 'project_proof_links')).toBe('fail'));
});

describe('skills_in_text', () => {
  it.each([
    ['comma list', GOOD],
    ['bulleted list', replace('Python, TypeScript, SQL, React, Docker', '- Python\n- SQL\n- React')],
    ['inline heading', replace('Skills\nPython, TypeScript, SQL, React, Docker', 'Skills: Python | Java | SQL | Git')],
  ])('pass: %s', (_n, text) => expect(status(input({ text }), 'skills_in_text')).toBe('pass'));
  it.each([
    ['no skills section', drop('Skills', 'Python,')],
    ['empty skills section', replace('Python, TypeScript, SQL, React, Docker', '')],
    ['only two skills', replace('Python, TypeScript, SQL, React, Docker', 'Python, SQL')],
  ])('fail: %s', (_n, text) => expect(status(input({ text }), 'skills_in_text')).toBe('fail'));
});

describe('sensible_file_name (via assessHealth)', () => {
  it.each(['Test_Student_Resume.pdf', 'Priya Sharma CV.docx', 'arjun-kumar-resume.pdf'])('pass: %s', (n) => {
    expect(status(input({ fileName: n }), 'sensible_file_name')).toBe('pass');
  });
  it.each(['IMG_20260101_0001.pdf', 'WhatsApp Document 2026-01-02.pdf', 'Untitled.docx', 'resume(1).pdf', 'resume.pdf'])('fail: %s', (n) => {
    expect(status(input({ fileName: n }), 'sensible_file_name')).toBe('fail');
  });
  it.each([null, undefined, ''])('unknown when no name is given: %j', (n) => {
    expect(status(input({ fileName: n as string | null | undefined }), 'sensible_file_name')).toBe('unknown');
  });
});

describe('checkFileName', () => {
  const bad = [
    'IMG_1234.pdf', 'img-5.pdf', 'WhatsApp Document.pdf', 'whatsapp_file_2026.docx', 'Untitled document.docx', 'untitled.pdf',
    'resume(1).pdf', 'Resume (2).pdf', 'resume.pdf', 'CV.pdf', 'Resume_final_v2.pdf', '12345678.pdf', 'document.pdf', 'New Doc 3.docx',
  ];
  const good = ['Test_Student_Resume.pdf', 'Test Student.docx', 'resume_priya_nair.pdf', 'CV-Arjun-Mehta.pdf', 'Student01 Resume.pdf', 'Rahul_S_CV.pdf'];
  it.each(bad)('flags %s', (n) => expect(checkFileName(n).ok).toBe(false));
  it.each(good)('accepts %s', (n) => expect(checkFileName(n).ok).toBe(true));
  it('accepts a path and ignores directories', () => {
    expect(checkFileName('/tmp/uploads/IMG_9.pdf').ok).toBe(false);
    expect(checkFileName('C:\\Users\\x\\Test_Student_Resume.pdf').ok).toBe(true);
  });
  it('never echoes the name in the result', () => {
    for (const n of [...bad, ...good]) {
      const r = JSON.stringify(checkFileName(n));
      const stem = n.replace(/\.[a-z]+$/i, '');
      expect(r.includes(stem), n).toBe(false);
    }
  });
});
