import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectSections, normalizeResumeText } from '../src/resume/sections';
import type { ResumeSection } from '../src/resume/types';

const here = dirname(fileURLToPath(import.meta.url));

interface ResumeRow {
  id: string;
  text: string;
  sections: { kind: string; heading: string }[];
}
function loadResumes(): ResumeRow[] {
  const lines = readFileSync(join(here, 'corpus', 'resumes.synthetic.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
  expect(JSON.parse(lines[0]!)._header.synthetic).toBe(true);
  return lines.slice(1).map((l) => JSON.parse(l) as ResumeRow);
}
const kinds = (s: ResumeSection[]) => s.map((x) => x.kind);

describe('normalizeResumeText', () => {
  it('applies NFKC, unifies line endings and drops zero-width characters', () => {
    expect(normalizeResumeText('Certiﬁcations\r\nA B​C')).toBe('Certifications\nA BC');
  });
  it('handles empty input', () => {
    expect(normalizeResumeText('')).toBe('');
  });
});

describe('detectSections: India-aware headings', () => {
  const cases: [string, string][] = [
    ['Academic Qualifications', 'education'],
    ['Educational Details', 'education'],
    ['Scholastic Record', 'education'],
    ['Education', 'education'],
    ['Personal Details', 'personal'],
    ['Biodata', 'personal'],
    ['Bio-Data', 'personal'],
    ['Declaration', 'declaration'],
    ['Self Declaration', 'declaration'],
    ['Career Objective', 'objective'],
    ['Projects', 'projects'],
    ['Academic Projects', 'projects'],
    ['Internships', 'internships'],
    ['Industrial Training', 'internships'],
    ['Certifications', 'certifications'],
    ['Courses & Certifications', 'certifications'],
    ['Achievements', 'achievements'],
    ['Awards and Achievements', 'achievements'],
    ['Scholastic Achievements', 'achievements'],
    ['Technical Skills', 'skills'],
    ['Skills', 'skills'],
    ['Links', 'links'],
    ['Online Profiles', 'links'],
    ['Work Experience', 'experience'],
    ['Hobbies', 'interests'],
    ['Languages Known', 'languages'],
  ];
  it.each(cases)('%s is %s', (heading, kind) => {
    const text = `Test Student\nsomething\n\n${heading}\nbody line\n`;
    const out = detectSections(text);
    expect(kinds(out)).toEqual(['header', kind]);
    expect(out[1]!.heading).toBe(heading);
  });

  it.each([
    ['EDUCATIONAL DETAILS', 'education'],
    ['Educational Details:', 'education'],
    ['1. Academic Qualifications', 'education'],
    ['--- Personal Details ---', 'personal'],
    ['■ DECLARATION', 'declaration'],
    ['E D U C A T I O N', 'education'],
    ['  Career   Objective  ', 'objective'],
  ])('tolerates decoration: %s', (line, kind) => {
    const out = detectSections(`Name\n\n${line}\nbody\n`);
    expect(kinds(out)).toEqual(['header', kind]);
  });

  it('offsets slice back to the section, [start, end), headings first', () => {
    const text = 'Name\nEmail\n\nEducation\nB.Tech 2026\n\nSkills\nPython, Java\n\nDeclaration\nI declare.\n';
    const out = detectSections(text);
    expect(kinds(out)).toEqual(['header', 'education', 'skills', 'declaration']);
    expect(text.slice(out[1]!.start, out[1]!.end)).toBe('Education\nB.Tech 2026');
    expect(text.slice(out[2]!.start, out[2]!.end)).toBe('Skills\nPython, Java');
    expect(text.slice(out[3]!.start, out[3]!.end)).toBe('Declaration\nI declare.');
    expect(text.slice(out[0]!.start, out[0]!.end)).toBe('Name\nEmail');
  });

  it('inline content after a colon is part of the section', () => {
    const text = 'Name\nTechnical Skills: Python, Java, SQL\nCareer Objective: To work in a good company.\nDeclaration: I hereby declare that all is true.';
    const out = detectSections(text);
    expect(kinds(out)).toEqual(['header', 'skills', 'objective', 'declaration']);
    expect(out[1]!.heading).toBe('Technical Skills');
    expect(text.slice(out[1]!.start, out[1]!.end)).toContain('Python, Java, SQL');
  });

  it('does not split a section on content lines that merely look like labels', () => {
    const text = 'Name\n\nSkills\nLanguages: Python, Java\nTools: Git\n\nPersonal Details\nLanguages Known: English, Hindi\nFather: X\n';
    expect(kinds(detectSections(text))).toEqual(['header', 'skills', 'personal']);
  });

  it('ignores long lines and sentences that contain a heading word', () => {
    const text = 'Name\nI am looking for projects that need skills in education technology and many other areas of work.\nProjects were great.\n';
    expect(detectSections(text)).toEqual([{ kind: 'header', heading: '', start: 0, end: text.trimEnd().length }]);
  });

  it('returns no sections for empty or whitespace input', () => {
    expect(detectSections('')).toEqual([]);
    expect(detectSections('  \n\n \t')).toEqual([]);
  });

  it('a document with no headings is one header section', () => {
    const out = detectSections('just some text\nwith lines');
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('header');
  });

  it('no header section when the text starts with a heading', () => {
    expect(kinds(detectSections('Education\nB.Tech\n'))).toEqual(['education']);
  });

  it('repeated headings produce separate sections in order', () => {
    expect(kinds(detectSections('Projects\na\nSkills\nb\nProjects\nc'))).toEqual(['projects', 'skills', 'projects']);
  });

  it('sections tile the text in order with no overlap', () => {
    const text = 'N\n\nEducation\nx\n\nProjects\ny\n\nSkills\nz';
    const out = detectSections(text);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.start).toBeGreaterThanOrEqual(out[i - 1]!.end);
      expect(out[i]!.start).toBeLessThan(out[i]!.end);
    }
  });

  it('special characters and emoji lines do not throw or match', () => {
    const out = detectSections('Name\n🎓 Education 🎓\n😀😀\n; DROP TABLE users; --\nSkills\nx');
    expect(kinds(out)).toEqual(['header', 'education', 'skills']);
  });

  it('is fast on a large document (10k+ lines)', () => {
    const big = ('Some content line here\n'.repeat(50) + 'Projects\n').repeat(300);
    const t0 = Date.now();
    const out = detectSections(big);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(out.filter((s) => s.kind === 'projects')).toHaveLength(300);
  });
});

describe('detectSections on the synthetic resume corpus', () => {
  const rows = loadResumes();
  it('has at least 40 resumes', () => {
    expect(rows.length).toBeGreaterThanOrEqual(40);
  });
  it('finds the labelled section kinds and headings in order on every resume', () => {
    const bad: string[] = [];
    for (const r of rows) {
      const got = detectSections(normalizeResumeText(r.text)).map((s) => `${s.kind}:${s.heading}`);
      const want = r.sections.map((s) => `${s.kind}:${s.heading}`);
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${r.id}\n  got  ${got.join(' | ')}\n  want ${want.join(' | ')}`);
    }
    expect(bad, bad.slice(0, 5).join('\n')).toEqual([]);
  });
  it('covers every required heading kind somewhere in the corpus', () => {
    const seen = new Set(rows.flatMap((r) => r.sections.map((s) => s.kind)));
    for (const k of ['education', 'personal', 'declaration', 'objective', 'projects', 'internships', 'certifications', 'achievements', 'skills', 'links']) expect(seen.has(k), k).toBe(true);
  });
});
