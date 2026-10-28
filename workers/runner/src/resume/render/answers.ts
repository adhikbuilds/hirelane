/**
 * Guided-builder answers (the 6 to 8 short questions). Sealed as JSON in `resumes.parsed_enc` while the row is a draft.
 * Hand-validated (the runner has no zod). Errors carry a code and a field path only, never a value.
 * Caps are chosen so the worst case still fits one page (see the render test).
 */
export class RenderError extends Error {
  constructor(
    readonly code: 'invalid_answers' | 'too_long' | 'render_failed',
    readonly path = '',
  ) {
    super(`${code}${path ? ` at ${path}` : ''}`);
    this.name = 'RenderError';
  }
}

export interface BuilderEducation { qualification: string; institution: string; year: string; score?: string }
export interface BuilderProject { title: string; link?: string; bullets: string[] }
export interface BuilderExperience { role: string; org: string; period?: string; bullets: string[] }
export interface BuilderAnswers {
  name: string;
  email: string;
  phone: string;
  city?: string;
  links?: string[];
  summary?: string;
  education: BuilderEducation[];
  skills: string[];
  projects: BuilderProject[];
  experience?: BuilderExperience[];
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

const clean = (s: string): string => s.replace(CONTROL, '').replace(/\s+/g, ' ').trim();

function str(v: unknown, path: string, min: number, max: number): string {
  if (typeof v !== 'string') throw new RenderError('invalid_answers', path);
  const s = clean(v);
  if (s.length < min || s.length > max) throw new RenderError('invalid_answers', path);
  return s;
}
const opt = (v: unknown, path: string, max: number): string | undefined => (v === undefined || v === null || v === '' ? undefined : str(v, path, 1, max));

function list<T>(v: unknown, path: string, min: number, max: number, each: (x: unknown, p: string) => T): T[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new RenderError('invalid_answers', path);
  return v.map((x, i) => each(x, `${path}[${i}]`));
}
function obj(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new RenderError('invalid_answers', path);
  for (const k of Object.keys(v)) if (!keys.includes(k)) throw new RenderError('invalid_answers', `${path}.${k}`);
  return v as Record<string, unknown>;
}

const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,4}$/;
const PHONE = /^(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/;
const URLISH = /^(?:https?:\/\/)?[A-Za-z0-9.-]{1,80}\.[A-Za-z]{2,}(?:\/[^\s]{0,100})?$/;

export function parseBuilderAnswers(input: unknown): BuilderAnswers {
  const o = obj(input, '', ['name', 'email', 'phone', 'city', 'links', 'summary', 'education', 'skills', 'projects', 'experience']);
  const email = str(o['email'], 'email', 3, 120);
  if (!EMAIL.test(email)) throw new RenderError('invalid_answers', 'email');
  const phone = str(o['phone'], 'phone', 10, 18);
  if (!PHONE.test(phone)) throw new RenderError('invalid_answers', 'phone');
  const url = (x: unknown, p: string) => {
    const s = str(x, p, 4, 120);
    if (!URLISH.test(s)) throw new RenderError('invalid_answers', p);
    return s;
  };
  const bullets = (x: unknown, p: string) => list(x, p, 1, 4, (b, bp) => str(b, bp, 3, 200));
  const a: BuilderAnswers = {
    name: str(o['name'], 'name', 2, 60),
    email,
    phone,
    education: list(o['education'], 'education', 1, 3, (x, p) => {
      const e = obj(x, p, ['qualification', 'institution', 'year', 'score']);
      const score = opt(e['score'], `${p}.score`, 30);
      return { qualification: str(e['qualification'], `${p}.qualification`, 2, 80), institution: str(e['institution'], `${p}.institution`, 2, 80), year: str(e['year'], `${p}.year`, 4, 9), ...(score ? { score } : {}) };
    }),
    skills: list(o['skills'], 'skills', 3, 20, (x, p) => str(x, p, 1, 30)),
    projects: list(o['projects'], 'projects', 1, 3, (x, p) => {
      const e = obj(x, p, ['title', 'link', 'bullets']);
      const link = e['link'] === undefined || e['link'] === '' ? undefined : url(e['link'], `${p}.link`);
      return { title: str(e['title'], `${p}.title`, 2, 80), ...(link ? { link } : {}), bullets: bullets(e['bullets'], `${p}.bullets`) };
    }),
  };
  const city = opt(o['city'], 'city', 40);
  if (city) a.city = city;
  const summary = opt(o['summary'], 'summary', 240);
  if (summary) a.summary = summary;
  if (o['links'] !== undefined) a.links = list(o['links'], 'links', 0, 3, url);
  if (o['experience'] !== undefined) {
    a.experience = list(o['experience'], 'experience', 0, 2, (x, p) => {
      const e = obj(x, p, ['role', 'org', 'period', 'bullets']);
      const period = opt(e['period'], `${p}.period`, 40);
      return { role: str(e['role'], `${p}.role`, 2, 60), org: str(e['org'], `${p}.org`, 2, 80), ...(period ? { period } : {}), bullets: bullets(e['bullets'], `${p}.bullets`) };
    });
  }
  return a;
}

/** `Firstname_Lastname_Resume.pdf`, ASCII only. Falls back to `Resume.pdf` when the name has no ASCII letters. */
export function builderFileName(a: Pick<BuilderAnswers, 'name'>): string {
  const parts = a.name
    .normalize('NFKD')
    .split(/[^A-Za-z]+/)
    .filter((p) => p.length > 0)
    .slice(0, 3)
    .map((p) => p.slice(0, 20).replace(/^./, (c) => c.toUpperCase()));
  return parts.length ? `${parts.join('_')}_Resume.pdf` : 'Resume.pdf';
}
