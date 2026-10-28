/**
 * Resume health check (Slice 1, task S1.8). Nine fixed, deterministic checks, each pass / fail /
 * unknown with a reason and a fix. Shown as "N of 9 checks pass", failing checks first. There is
 * NO score out of 100. Pure code: no I/O, no LLM. Reasons never echo resume content or the file name.
 */
import { assessTextLayer } from './text-layer';
import { detectSections, normalizeResumeText } from './sections';
import { detectSensitive } from './sensitive';
import type { ExtractMeta, HealthCheck, HealthCheckId, ResumeSection, SensitiveKind, TextLayer } from './types';

export interface HealthInput {
  /** Extracted text (normalised here, so raw extractor output is fine). */
  text: string;
  meta: ExtractMeta;
  /** Original upload file name. Only inspected, never echoed. null/empty makes sensible_file_name unknown. */
  fileName?: string | null;
}

export interface HealthReport {
  /** Failing checks first, then unknown, then passing. Canonical order within each group. */
  checks: HealthCheck[];
  passCount: number;
  total: 9;
  /** "N of 9 checks pass". */
  summary: string;
  textLayer: TextLayer;
}

const ORDER: HealthCheckId[] = [
  'ats_readable', 'one_page', 'contact_present', 'no_biodata_ids', 'no_padding',
  'bullets_with_numbers', 'project_proof_links', 'skills_in_text', 'sensible_file_name',
];

type Partial1 = Pick<HealthCheck, 'status' | 'reason' | 'fix'>;
const pass = (reason: string): Partial1 => ({ status: 'pass', reason, fix: 'Nothing to change.' });
const fail = (reason: string, fix: string): Partial1 => ({ status: 'fail', reason, fix });
const unknown = (reason: string, fix: string): Partial1 => ({ status: 'unknown', reason, fix });

// ---------- file name ----------

export type FileNameProblem = 'camera_name' | 'messaging_app' | 'placeholder_name' | 'copy_suffix' | 'no_person_token';
export interface FileNameResult {
  ok: boolean;
  problems: FileNameProblem[];
}

const NAME_STOP = new Set([
  'resume', 'resumes', 'cv', 'curriculum', 'vitae', 'final', 'new', 'newest', 'doc', 'docs', 'document', 'file', 'copy', 'updated',
  'update', 'latest', 'my', 'fresher', 'freshers', 'pdf', 'docx', 'version', 'draft', 'profile', 'scan', 'scanned', 'img', 'image',
  'template', 'untitled', 'download', 'export', 'new', 'for', 'of', 'the', 'and', 'jobs', 'job', 'application',
]);

/** Judge an upload file name. Returns problem codes only; the name itself is never returned. */
export function checkFileName(fileName: string): FileNameResult {
  const base = String(fileName ?? '').slice(0, 512).split(/[\\/]/).pop() ?? '';
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const problems: FileNameProblem[] = [];
  if (/^(?:img|dsc|dscn|pxl|mvimg|scan|image)[\s_-]{0,2}\d/i.test(stem)) problems.push('camera_name');
  if (/whatsapp/i.test(stem)) problems.push('messaging_app');
  if (/untitled/i.test(stem)) problems.push('placeholder_name');
  if (/\(\s{0,2}\d{1,3}\s{0,2}\)\s{0,2}$/.test(stem) || /[\s_-]copy(?:[\s_-]?\d{0,3})?$/i.test(stem)) problems.push('copy_suffix');
  const tokens = stem.split(/[^A-Za-z]+/).map((t) => t.toLowerCase()).filter((t) => t.length >= 2 && !NAME_STOP.has(t));
  if (tokens.length === 0) problems.push('no_person_token');
  return { ok: problems.length === 0, problems };
}

// ---------- helpers ----------

const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,4}/;
const PHONE_RE = /(?<!\d)(?:\+?91[\s-]{0,2})?[6-9]\d{4}[\s-]?\d{5}(?!\d)/;
const BULLET_RE = /^[ \t]{0,6}[-\u2022*\u25AA\u25CF\u25E6\u2013\u00B7\u27A2\u27A4\u25BA\u2713][ \t]{1,4}\S/;
const LINK_RE = /https?:\/\/|\bwww\.|github\.com|gitlab\.com|bitbucket\.org|\.vercel\.app|\.netlify\.app|\.herokuapp\.com/i;

const KIND_LABEL: Partial<Record<SensitiveKind, string>> = {
  aadhaar: 'an Aadhaar number', aadhaar_masked: 'a masked Aadhaar number', vid: 'an Aadhaar virtual ID', pan: 'a PAN',
  dob: 'a date of birth', parent_name: "a parent's name", religion: 'religion', caste: 'caste or category', marital_status: 'marital status',
};

function sectionBody(text: string, s: ResumeSection): string {
  const raw = text.slice(s.start, s.end);
  if (!s.heading) return raw;
  const afterHeading = raw.startsWith(s.heading) ? raw.slice(s.heading.length) : raw.slice(raw.indexOf('\n') + 1);
  return afterHeading.replace(/^[\s:\-\u2013]+/, '');
}

function skillCount(body: string): number {
  return body
    .split(/[\n,|;\u2022\u00B7*]+|\s-\s|^-\s/m)
    .map((x) => x.replace(/^[\s\-:]+|[\s]+$/g, ''))
    .filter((x) => /[A-Za-z0-9]/.test(x)).length;
}

// ---------- the checks ----------

export function assessHealth(input: HealthInput): HealthReport {
  const text = normalizeResumeText(typeof input.text === 'string' ? input.text : '');
  const { meta } = input;
  const layer = assessTextLayer(meta, text);
  const results = new Map<HealthCheckId, Partial1>();

  if (layer === 'none' || layer === 'garbled') {
    results.set(
      'ats_readable',
      fail(
        layer === 'none' ? 'No readable text was found in this file, so recruiter software sees a blank page.' : 'The text in this file is garbled, so recruiter software cannot read it.',
        'Re-export the resume as a text PDF (not a scan or screenshot), or build it with the Hirelane resume builder.',
      ),
    );
    for (const id of ORDER.slice(1)) {
      results.set(id, unknown('Not checked: the file has no readable text.', 'Fix the readable-text problem first, then upload again.'));
    }
    return finish(results, layer);
  }

  results.set(
    'ats_readable',
    layer === 'readable'
      ? pass('Text can be read from every page.')
      : fail('Some pages have no readable text, probably images or scans.', 'Re-export every page as real text, or use the Hirelane resume builder.'),
  );

  // one_page
  if (meta.kind === 'docx') results.set('one_page', unknown('Page count cannot be known for a Word file.', 'Export to PDF and check that it fits on one page.'));
  else if (!meta.pages || meta.pages < 1) results.set('one_page', unknown('The page count could not be read.', 'Check that the resume fits on one page.'));
  else if (meta.pages === 1) results.set('one_page', pass('The resume is one page.'));
  else results.set('one_page', fail(`The resume is ${meta.pages} pages long.`, 'Trim it to one page. Freshers rarely need more.'));

  // contact_present
  const hasEmail = EMAIL_RE.test(text);
  const hasPhone = PHONE_RE.test(text);
  if (hasEmail && hasPhone) results.set('contact_present', pass('An email and a phone number are present.'));
  else {
    const missing = [!hasEmail && 'email', !hasPhone && 'phone number'].filter(Boolean).join(' and ');
    results.set('contact_present', fail(`No ${missing} found.`, 'Put your email and a 10-digit mobile number near the top.'));
  }

  // no_biodata_ids
  const kinds = [...new Set(detectSensitive(text).map((f) => f.kind))].filter((k) => k !== 'image');
  if (kinds.length === 0) results.set('no_biodata_ids', pass('No ID numbers or biodata details found.'));
  else {
    results.set(
      'no_biodata_ids',
      fail(`Found ${kinds.map((k) => KIND_LABEL[k] ?? k).join(', ')}.`, 'Remove these. Employers do not need them on a resume and they can be misused.'),
    );
  }

  // sections
  const sections = detectSections(text);
  const of = (...k: string[]) => sections.filter((s) => k.includes(s.kind));

  // no_padding
  const padKinds = [...new Set(of('declaration', 'personal', 'interests').map((s) => s.kind))];
  const declSentence = /\bI\s+hereby\s+declare\b/i.test(text);
  if (padKinds.length === 0 && !declSentence) results.set('no_padding', pass('No declaration, personal-details or hobbies filler.'));
  else {
    const what = [...padKinds.map((k) => (k === 'declaration' ? 'a declaration' : k === 'personal' ? 'personal details' : 'hobbies')), ...(declSentence && !padKinds.includes('declaration') ? ['a declaration'] : [])];
    results.set('no_padding', fail(`Found ${what.join(', ')}.`, 'Delete these sections and use the space for projects or skills.'));
  }

  // bullets_with_numbers
  const exp = of('experience', 'projects', 'internships');
  const scope = exp.length ? exp.map((s) => text.slice(s.start, s.end)).join('\n') : text;
  const bullets = scope.split('\n').filter((l) => BULLET_RE.test(l));
  const numeric = bullets.filter((l) => /\d/.test(l)).length;
  if (bullets.length === 0) results.set('bullets_with_numbers', fail('No bullet points found.', 'Describe each project or internship in short bullets that start with a verb.'));
  else if (numeric * 2 >= bullets.length) results.set('bullets_with_numbers', pass(`${numeric} of ${bullets.length} bullets include a number.`));
  else results.set('bullets_with_numbers', fail(`Only ${numeric} of ${bullets.length} bullets include a number.`, 'Add numbers: users, speed-ups, percentages, sizes, counts.'));

  // project_proof_links
  const projects = of('projects');
  if (projects.length === 0) results.set('project_proof_links', fail('No projects section found.', 'Add a Projects section with a GitHub or live link for each project.'));
  else if (projects.some((s) => LINK_RE.test(text.slice(s.start, s.end)))) results.set('project_proof_links', pass('A project has a proof link.'));
  else results.set('project_proof_links', fail('Projects have no links.', 'Add a GitHub or live-demo link under each project.'));

  // skills_in_text
  const skills = of('skills');
  const n = skills.reduce((a, s) => a + skillCount(sectionBody(text, s)), 0);
  if (skills.length === 0) results.set('skills_in_text', fail('No skills section found.', 'Add a Skills section that lists tools as plain text.'));
  else if (n < 3) results.set('skills_in_text', fail('The skills section lists fewer than 3 skills.', 'List your tools and languages as plain text, separated by commas.'));
  else results.set('skills_in_text', pass(`${n} skills are listed as text.`));

  // sensible_file_name
  const fn = typeof input.fileName === 'string' ? input.fileName.trim() : '';
  if (!fn) results.set('sensible_file_name', unknown('No file name was provided.', 'Name the file like Firstname_Lastname_Resume.pdf.'));
  else {
    const r = checkFileName(fn);
    results.set(
      'sensible_file_name',
      r.ok ? pass('The file name looks like a person name.') : fail('The file name looks generic, auto-generated or has no name in it.', 'Rename it to Firstname_Lastname_Resume.pdf.'),
    );
  }

  return finish(results, layer);
}

function finish(results: Map<HealthCheckId, Partial1>, textLayer: TextLayer): HealthReport {
  const rank = { fail: 0, unknown: 1, pass: 2 } as const;
  const checks: HealthCheck[] = ORDER.map((id) => ({ id, ...results.get(id)! }));
  checks.sort((a, b) => rank[a.status] - rank[b.status] || ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const passCount = checks.filter((c) => c.status === 'pass').length;
  return { checks, passCount, total: 9, summary: `${passCount} of 9 checks pass`, textLayer };
}
