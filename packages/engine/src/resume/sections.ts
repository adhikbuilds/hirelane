/**
 * Resume section detection (Slice 1, task S1.4). Pure and rules-only: India-aware heading
 * aliases ("Scholastic Record", "Biodata", "Declaration", ...), no LLM, no I/O.
 *
 * All offsets are UTF-16 code-unit indexes into the text passed in, [start, end). Callers pass
 * text that went through normalizeResumeText so that offsets are stable across the pipeline.
 */
import type { ResumeSection } from './types';

export type SectionKind =
  | 'header'
  | 'education'
  | 'personal'
  | 'declaration'
  | 'objective'
  | 'summary'
  | 'contact'
  | 'projects'
  | 'internships'
  | 'experience'
  | 'certifications'
  | 'achievements'
  | 'activities'
  | 'skills'
  | 'links'
  | 'languages'
  | 'interests';

/** NFKC, LF line endings, zero-width and soft-hyphen characters removed. */
export function normalizeResumeText(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  return text
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F]/g, (ch) => {
      const c = ch.charCodeAt(0);
      const base = c >= 0x966 ? 0x966 : c >= 0x6f0 ? 0x6f0 : 0x660;
      return String(c - base);
    });
}

const ALIASES: Record<Exclude<SectionKind, 'header'>, string[]> = {
  education: [
    'education', 'educational qualification', 'educational qualifications', 'educational details', 'educational background',
    'education details', 'education qualification', 'education qualifications', 'education and qualifications',
    'academic qualification', 'academic qualifications', 'academic details', 'academic profile', 'academic record',
    'academic records', 'academic background', 'academics', 'scholastic record', 'scholastic profile', 'qualification',
    'qualifications', 'education and training',
  ],
  personal: [
    'personal details', 'personal information', 'personal profile', 'personal data', 'personal particulars', 'personal info',
    'biodata', 'bio data', 'personal',
  ],
  declaration: ['declaration', 'self declaration', 'undertaking'],
  objective: ['career objective', 'objective', 'career goal', 'professional objective', 'objective statement', 'job objective'],
  summary: ['summary', 'professional summary', 'profile', 'profile summary', 'about me', 'career summary', 'executive summary'],
  contact: ['contact', 'contact details', 'contact information'],
  projects: [
    'projects', 'project', 'academic projects', 'project work', 'personal projects', 'major projects', 'mini projects',
    'key projects', 'project details', 'projects undertaken', 'technical projects', 'project experience',
  ],
  internships: [
    'internships', 'internship', 'internship experience', 'industrial training', 'training', 'summer internship',
    'internships and training', 'training and internships', 'industrial training and internships', 'internship and training',
  ],
  experience: ['experience', 'work experience', 'professional experience', 'employment history', 'work history', 'employment'],
  certifications: [
    'certifications', 'certification', 'certificates', 'courses and certifications', 'certifications and courses',
    'licenses and certifications', 'online courses', 'courses', 'training and certifications', 'professional certifications',
    'moocs', 'certifications and licenses',
  ],
  achievements: [
    'achievements', 'achievement', 'accomplishments', 'awards', 'awards and achievements', 'achievements and awards',
    'honors and awards', 'honours and awards', 'scholastic achievements', 'academic achievements', 'awards and honors',
    'awards and recognition',
  ],
  activities: [
    'extra curricular activities', 'extracurricular activities', 'co curricular activities', 'extra curricular',
    'positions of responsibility', 'activities', 'volunteering', 'leadership',
  ],
  skills: [
    'skills', 'technical skills', 'key skills', 'core competencies', 'skill set', 'skills summary', 'it skills',
    'computer skills', 'technical proficiency', 'technical expertise', 'skills and tools', 'technologies',
  ],
  links: ['links', 'profiles', 'social links', 'online profiles', 'important links', 'web links', 'profile links', 'portfolio'],
  languages: ['languages', 'languages known', 'language proficiency', 'language skills'],
  interests: ['hobbies', 'interests', 'hobbies and interests', 'areas of interest', 'extra interests', 'hobbies and activities'],
};

/** Kinds where "Heading: content" on one line is read as a heading plus its first content line. */
const INLINE_OK = new Set<SectionKind>(['objective', 'summary', 'declaration', 'skills', 'education', 'links']);

const LOOKUP: Map<string, SectionKind> = (() => {
  const m = new Map<string, SectionKind>();
  for (const [kind, list] of Object.entries(ALIASES)) for (const a of list) m.set(a, kind as SectionKind);
  return m;
})();

const MAX_HEADING_LINE = 80;
const MAX_INLINE_HEAD = 40;

function canon(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Remove bullets, rules and numbering around a candidate heading. */
function stripDecoration(raw: string): string {
  let s = raw.replace(/^[^\p{L}\p{N}]+/u, '');
  s = s.replace(/^(?:\d{1,2}|[ivx]{1,4}|[a-z])[.)]\s+/i, '');
  s = s.replace(/[^\p{L}\p{N}]+$/u, '');
  // Letter-spaced headings: "E D U C A T I O N   D E T A I L S".
  if (/^(?:\p{L}\s){4,}\p{L}$/u.test(s) || /^(?:\p{L}\s)+\p{L}(?:\s{2,}(?:\p{L}\s)*\p{L})+$/u.test(s)) {
    s = s
      .split(/\s{2,}/)
      .map((w) => w.replace(/\s/g, ''))
      .join(' ');
  }
  return s;
}

interface HeadingHit {
  kind: SectionKind;
  heading: string;
}

function matchHeading(line: string): HeadingHit | null {
  const t = line.trim();
  if (t.length === 0) return null;
  const s = stripDecoration(t);
  if (s.length === 0) return null;
  const colon = s.indexOf(':');
  if (colon > 0 && colon <= MAX_INLINE_HEAD && s.slice(colon + 1).trim().length > 0) {
    const head = s.slice(0, colon).trim();
    const kind = LOOKUP.get(canon(head));
    if (kind && INLINE_OK.has(kind)) return { kind, heading: head };
    return null;
  }
  if (t.length > MAX_HEADING_LINE) return null;
  const bare = s.replace(/:+$/, '').trim();
  const kind = LOOKUP.get(canon(bare));
  return kind ? { kind, heading: bare } : null;
}

/**
 * Split a resume into sections. Text before the first heading becomes a 'header' section. Each
 * section starts at its heading and ends just before the next heading (trailing blanks trimmed).
 * Returns [] for empty or whitespace-only input.
 */
export function detectSections(text: string): ResumeSection[] {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const heads: { kind: SectionKind; heading: string; start: number }[] = [];
  let pos = 0;
  while (pos <= text.length) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = text.length;
    const line = text.slice(pos, nl);
    const hit = matchHeading(line);
    if (hit) heads.push({ ...hit, start: pos + (line.length - line.trimStart().length) });
    pos = nl + 1;
  }
  const textEnd = text.trimEnd().length;
  const out: ResumeSection[] = [];
  const first = heads[0]?.start ?? textEnd;
  const pre = text.slice(0, first).trimEnd();
  if (pre.trim().length > 0) out.push({ kind: 'header', heading: '', start: text.length - text.trimStart().length, end: pre.length });
  heads.forEach((h, i) => {
    const limit = heads[i + 1]?.start ?? textEnd;
    const end = Math.max(h.start + 1, text.slice(h.start, limit).trimEnd().length + h.start);
    out.push({ kind: h.kind, heading: h.heading, start: h.start, end });
  });
  return out;
}
