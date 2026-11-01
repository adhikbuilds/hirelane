/**
 * Paste-a-job parsing (PRD S5 / S5a) and drive-notice parsing (S6). Pure, rule-only, 0 LLM calls.
 *
 * The URL is only ever handled as a string. Nothing here fetches, resolves or opens it.
 *
 * Offsets: everything refers to `ParsedJob.text`, the normalised paste (CRLF folded, zero-width and
 * markdown emphasis removed, whitespace collapsed per line, blocks as produced by `toDoc`). Requirement
 * and criterion evidence use the same string.
 */
import { classifyLevel, classifyWorkplace, type Level, type Workplace } from './classify';
import { canonicalTitle } from './dedup';
import { EngineInvariantError } from './errors';
import { evaluateEligibility, parseCriteria } from './eligibility';
import type { CgpaRule, Criterion, EligibilityProfileInput, EligibilityResult } from './eligibility/types';
import { assessFresher, type FresherResult } from './fresher';
import { defaultPlaceIndex, isKnownPlace, resolveCountries } from './places';
import { extractRequirements, classifyHeading, type Requirement } from './requirements';
import { parseSalary, type SalaryParse } from './salary';
import { detectScamSignals, type ScamResult } from './scam';
import { toDoc } from './text';
import type { UniversityRule } from './eligibility/university';
import { isWorthwhile, type WorthwhileResult } from './worthwhile';

export type SourceHint = 'naukri' | 'linkedin' | 'whatsapp' | 'other';
export type JobField = 'title' | 'company' | 'location' | 'applyUrl';

export interface FieldEvidence {
  field: JobField;
  start: number;
  end: number;
  quote: string;
}

export interface ParsedJob {
  /** The normalised paste. Every offset below indexes this string. */
  text: string;
  title: string | null;
  company: string | null;
  locations: string[];
  countries: string[];
  workplace: Workplace | null;
  level: Level | null;
  fresher: FresherResult;
  salary: SalaryParse | null;
  requirements: Requirement[];
  criteria: Criterion[];
  applyUrl: string | null;
  sourceHint: SourceHint;
  scamFlags: ScamResult;
  evidence: FieldEvidence[];
}

export interface ParseOptions {
  /** A link the student shared with the paste. Parsed as a string only; never fetched. */
  sharedUrl?: string | null;
}

const MAX_CHARS = 100_000;
const MAX_LINE = 600;

// ---------------------------------------------------------------------------------------------
// source hint from a URL string

function hostOf(u: string): string {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([^/:?#\s]+)/i.exec(u.trim());
  return m ? m[1]!.toLowerCase().replace(/^www\./, '') : '';
}
const hostIs = (h: string, d: string): boolean => h === d || h.endsWith('.' + d);

export function sourceHintFromUrl(url: string | null | undefined): SourceHint {
  if (typeof url !== 'string') return 'other';
  const h = hostOf(url);
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(h)) return 'other';
  if (hostIs(h, 'naukri.com')) return 'naukri';
  if (hostIs(h, 'linkedin.com') || hostIs(h, 'lnkd.in')) return 'linkedin';
  if (hostIs(h, 'wa.me') || hostIs(h, 'whatsapp.com')) return 'whatsapp';
  return 'other';
}

// ---------------------------------------------------------------------------------------------
// normalisation

interface Line {
  /** Text after stripping decoration, emphasis and bullet markers. */
  text: string;
  lead: string;
  bullet: boolean;
  kind: 'h' | 'li' | 'p';
  /** Offset of `text` in the normalised doc text. */
  at: number;
}

const ZERO_WIDTH = /[​-‏⁠﻿­]/g;
const LEAD_RE = /^[\s\p{Extended_Pictographic}️‍⃣•●▪▫■□◆◇►▶➤➢→✓✔*#\-–—~]+/u;
const TRAIL_RE = /[\s\p{Extended_Pictographic}️‍]+$/u;
const BULLET_CHARS = /[-–—•●▪▫■□◆◇►▶➤➢→✓✔✅☑👉🔹🔸]/u;
const LABEL_RE = /^([A-Za-z][A-Za-z ./&]{1,28}?)\s*[:\-–|]\s*(\S.*)$/;

const TITLE_LABELS = new Set(['job', 'job title', 'job role', 'role', 'position', 'post', 'designation', 'opening', 'vacancy', 'profile', 'hiring for', 'job position', 'post name', 'role name', 'position name']);
const COMPANY_LABELS = new Set(['company', 'company name', 'organization', 'organisation', 'employer', 'firm', 'hiring company', 'client']);
const LOC_LABELS = new Set(['location', 'loc', 'job location', 'work location', 'place of work', 'venue', 'city', 'work place', 'office location', 'posting location', 'locations']);
const MODE_LABELS = new Set(['mode', 'work mode', 'work type', 'job mode']);
const EXTRA_HEADING = /^(?:eligibility(?: criteria)?|who can apply|academic criteria|qualifications?(?: and eligibility)?|criteria|selection process|about the job|job description|responsibilities|requirements?|skills? required|key skills|desired skills|nice to have)$/i;

function stripEmphasis(s: string): string {
  return s
    .replace(/(^|[\s(\[])[*_~]+(?=[^\s*_~])/g, '$1')
    .replace(/(?<=[^\s*_~])[*_~]+(?=$|[\s)\].,:;!?])/g, '');
}

function labelOf(text: string): { label: string; value: string; valueAt: number } | null {
  const m = LABEL_RE.exec(text);
  if (!m) return null;
  const value = m[2]!;
  return { label: m[1]!.trim().toLowerCase(), value, valueAt: text.length - value.length };
}

function normalise(raw: string): { lines: Line[]; text: string; requirements: Requirement[] } {
  const src = raw.slice(0, MAX_CHARS).replace(ZERO_WIDTH, '').replace(/\r\n?/g, '\n').replace(/<\/?[a-z][^>]*>/gi, '');
  const prepared: Omit<Line, 'at'>[] = [];
  const physical: string[] = [];
  for (const l of src.split('\n')) {
    const segs = l.slice(0, MAX_LINE).split(/\s+\|\s+/);
    if (segs.length >= 2 && segs.filter((x) => LABEL_RE.test(stripEmphasis(x).trim())).length >= 2) physical.push(...segs);
    else physical.push(l);
  }
  for (const rawLine of physical) {
    const s = stripEmphasis(rawLine.slice(0, MAX_LINE)).replace(/\s+/g, ' ').trim();
    if (s === '') continue;
    const lm = LEAD_RE.exec(s);
    const lead = lm ? lm[0] : '';
    let body = s.slice(lead.length);
    const num = /^(\d{1,2})[.)]\s+(?=\S)/.exec(body);
    let bullet = (lead !== '' && BULLET_CHARS.test(lead)) || num !== null;
    if (num) body = body.slice(num[0].length);
    body = body.replace(TRAIL_RE, '').trim();
    if (body === '') continue;
    const lab = labelOf(body);
    if (lab && (TITLE_LABELS.has(lab.label) || COMPANY_LABELS.has(lab.label) || LOC_LABELS.has(lab.label) || MODE_LABELS.has(lab.label))) bullet = false;
    let kind: Line['kind'] = bullet ? 'li' : 'p';
    if (!bullet) {
      const head = body.replace(/\s*:\s*$/, '');
      if (head.length <= 40 && !/[.!?]$/.test(head) && (EXTRA_HEADING.test(head) || classifyHeading(head).kind !== 'other') && (body.endsWith(':') || EXTRA_HEADING.test(head) || classifyHeading(head).kind !== 'other')) kind = 'h';
    }
    prepared.push({ text: body, lead, bullet, kind });
  }
  const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = '';
  let inList = false;
  for (const l of prepared) {
    if (l.kind === 'li') {
      if (!inList) html += '<ul>';
      inList = true;
      html += `<li>${esc(l.text)}</li>`;
    } else {
      if (inList) html += '</ul>';
      inList = false;
      html += l.kind === 'h' ? `<h3>${esc(l.text)}</h3>` : `<p>${esc(l.text)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  const doc = toDoc(html);
  const lines: Line[] = [];
  let cursor = 0;
  for (const l of prepared) {
    let at = doc.text.indexOf(l.text, cursor);
    if (at < 0) at = cursor;
    else cursor = at + l.text.length;
    lines.push({ ...l, at });
  }
  return { lines, text: doc.text, requirements: extractRequirements(doc).requirements };
}

// ---------------------------------------------------------------------------------------------
// title and company

const ROLE_RE = /\b(?:engineers?|developers?|analysts?|executives?|associates?|trainees?|interns?|internship|managers?|officers?|consultants?|specialists?|designers?|administrators?|accountants?|recruiters?|representatives?|assistants?|coordinators?|programmers?|architects?|testers?|scientists?|technicians?|writers?|apprentices?|sde|qa|support|marketer|strategist|developer)\b/i;
const STAT_RE = /★|\breviews?\b|\byrs?\b|\byears?\b|\blpa\b|₹|\bctc\b|\bsalary\b|\bapplicants?\b|\breposted\b|\bposted\b|^\d/i;

function cleanValue(s: string): string {
  return s
    .replace(/^[\s"'`:\-–|]+/, '')
    .replace(/[\s"'`.,;:!|\-–]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Hit {
  value: string;
  at: number;
}

function hit(line: Line, value: string, valueAt: number, isCompany = false): Hit | null {
  const v = cleanValue(isCompany ? value.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*,\s.*$|\s+\|\s.*$|\.\s+[A-Z].*$/, '') : value);
  if (v.length < 2 || v.length > 120) return null;
  const rel = line.text.indexOf(v, Math.max(0, valueAt));
  return { value: v, at: line.at + (rel < 0 ? Math.max(0, valueAt) : rel) };
}

type Pair = { title?: Hit | null; company?: Hit | null };

function patternPairs(line: Line): Pair | null {
  const t = line.text;
  let m: RegExpExecArray | null;
  const sub = (g: string, from = 0): number => t.indexOf(g, from);
  const co = (g: string, from = 0): Hit | null => hit(line, g, from, true);
  const cutTail = (s: string): string => s.replace(/\s+(?:to|who|with|for|in|at|on|from)\s+.*$/i, '').replace(/[,.].*$/, '');
  if ((m = /^(.{2,80}?)\s+(?:is|are)\s+(?:now\s+)?hiring\s*(?:for|:|-|–)?\s*(?:an?\s+|the\s+)?(.*)$/i.exec(t))) {
    // "We are hiring a Python Developer to join our team": the subject is not a company name.
    const title = cutTail(m[2]!);
    const pronoun = /^(?:we|i|they|you|our team|the team|the company)$/i.test(m[1]!.trim());
    return { company: pronoun ? null : co(m[1]!, 0), title: title && ROLE_RE.test(title) ? hit(line, title, sub(title, m[1]!.length)) : null };
  }
  if ((m = /^(.{2,80}?)\s+hiring\s+(?:freshers?\s+)?for\s+(?:the\s+)?(?:post\s+of\s+)?(.+)$/i.exec(t))) {
    return { company: co(m[1]!, 0), title: hit(line, cutTail(m[2]!), sub(m[2]!, m[1]!.length)) };
  }
  if ((m = /^(.{2,60}?)\s+hiring\s+(?!freshers?\b|alert\b)(.{3,70})$/i.exec(t)) && ROLE_RE.test(m[2]!) && !/^(?:is|are|for)\b/i.test(m[2]!)) {
    return { company: co(m[1]!, 0), title: hit(line, cutTail(m[2]!), sub(m[2]!, m[1]!.length)) };
  }
  if ((m = /^(.{2,80}?)\s+(?:is|are|will be)\s+(?:now\s+)?(?:conducting|hosting|organi[sz]ing|having)\b.*?\b(?:drive|hiring|interview)s?\b.*?\bfor\s+(?:the\s+)?(?:(?:role|position|post)\s+of\s+)?(.+)$/i.exec(t))) {
    return { company: co(m[1]!, 0), title: hit(line, cutTail(m[2]!), sub(m[2]!, m[1]!.length)) };
  }
  if ((m = /^(?:urgent(?:ly)?\s+)?(?:opening|requirement|vacancy|openings|requirements)\s+(?:for|of)\s+(.+?)\s+(?:at|in|with)\s+(.{2,80})$/i.exec(t))) {
    return { title: hit(line, m[1]!, 0), company: co(m[2]!, t.lastIndexOf(m[2]!)) };
  }
  if ((m = /^hiring(?:\s+alert)?[!:\s-]*\s*(.+?)\s+(?:at|@)\s+(.{2,80})$/i.exec(t))) {
    return { title: hit(line, m[1]!, 0), company: co(m[2]!, t.lastIndexOf(m[2]!)) };
  }
  if ((m = /^hiring\s*[:\-–]\s*(.+)$/i.exec(t))) return { title: hit(line, m[1]!, 0) };
  if ((m = /\binvites?\s+applications?\b.*?\b(?:position|post|role)\s+of\s+(.+)$/i.exec(t))) {
    const c = /^(.{2,80}?)\s+invites?\b/i.exec(t);
    return { title: hit(line, cutTail(m[1]!), sub(m[1]!)), company: c ? co(c[1]!, 0) : null };
  }
  if ((m = /^(.{2,80}?)\s+(?:off[- ]?campus|campus|walk[- ]?in)\s+(?:drive|hiring|recruitment|interview)\b/i.exec(t))) return { company: co(m[1]!, 0) };
  if ((m = /\b(?:drive|hiring)\b.*\|\s*([^|]{2,60})$/i.exec(t))) return { company: co(m[1]!, t.lastIndexOf(m[1]!)) };
  if ((m = /^about\s+(.{2,60}?)\s*:?$/i.exec(t)) && !/^about the (?:job|role|company)/i.test(t)) return { company: co(m[1]!, 0) };
  return null;
}

function splitDash(line: Line): Pair | null {
  const m = /^(.{2,70}?)\s+(?:-|–|—|\||@|at)\s+(.{2,70})$/i.exec(line.text);
  if (!m) return null;
  const a = m[1]!;
  const b = m[2]!;
  if (STAT_RE.test(a) || STAT_RE.test(b)) return null;
  const aRole = ROLE_RE.test(a);
  const bRole = ROLE_RE.test(b);
  if (aRole === bRole) return null;
  const aAt = 0;
  const bAt = line.text.length - b.length;
  return aRole ? { title: hit(line, a, aAt), company: hit(line, b, bAt, true) } : { title: hit(line, b, bAt), company: hit(line, a, aAt, true) };
}

function extractTitleCompany(lines: Line[]): { title: Hit | null; company: Hit | null } {
  let title: Hit | null = null;
  let company: Hit | null = null;
  // 1. explicit labels
  for (const l of lines) {
    const lab = labelOf(l.text);
    if (!lab) continue;
    if (!title && TITLE_LABELS.has(lab.label)) title = hit(l, lab.value, lab.valueAt);
    else if (!company && COMPANY_LABELS.has(lab.label)) company = hit(l, lab.value, lab.valueAt, true);
  }
  // 2. phrases such as "X is hiring for Y"
  for (const l of lines) {
    if (title && company) break;
    if (l.kind === 'li' || l.text.length > 160) continue;
    const p = patternPairs(l);
    if (!p) continue;
    if (!title && p.title) title = p.title;
    if (!company && p.company) company = p.company;
  }
  // 3. the first line: "Title" then "Company", or "Company - Title"
  const first = lines.find((l) => l.kind !== 'li') ?? null;
  if (first && (!title || !company)) {
    const sp = splitDash(first);
    if (sp) {
      if (!title && sp.title) title = sp.title;
      if (!company && sp.company) company = sp.company;
    }
  }
  if (first && ROLE_RE.test(first.text) && !STAT_RE.test(first.text) && first.text.length <= 90 && labelOf(first.text) === null && patternPairs(first) === null) {
    if (!title) title = hit(first, first.text, 0);
    const next = lines[lines.indexOf(first) + 1];
    if (!company && next && next.kind === 'p' && !STAT_RE.test(next.text) && labelOf(next.text) === null && next.text.length <= 80 && !ROLE_RE.test(next.text) && !/^(?:job description|about the job)/i.test(next.text)) {
      company = hit(next, next.text.split(/\s+[·•|]\s+/)[0]!, 0, true);
    }
  }
  if (first && (!title || !company)) {
    const second = lines[lines.indexOf(first) + 1];
    const plain = (l: Line | undefined): l is Line => !!l && l.kind === 'p' && !STAT_RE.test(l.text) && labelOf(l.text) === null && l.text.length <= 80;
    if (plain(first) && plain(second) && !ROLE_RE.test(first.text) && ROLE_RE.test(second.text) && patternPairs(first) === null) {
      if (!company) company = hit(first, first.text.split(/\s+[·•|]\s+/)[0]!, 0, true);
      if (!title) title = hit(second, second.text, 0);
    }
  }
  return { title, company };
}

// ---------------------------------------------------------------------------------------------
// location and workplace

const WORKPLACE_PAREN = /\((on[- ]?site|hybrid|remote|work from home|wfh)\)/i;

function workplaceWord(s: string): Workplace | null {
  const m = /\b(remote|work from home|wfh|hybrid|on[- ]?site|onsite|work from office|wfo|in[- ]office)\b/i.exec(s);
  if (!m) return null;
  const w = m[1]!.toLowerCase();
  if (w === 'remote' || w === 'work from home' || w === 'wfh') return 'remote';
  if (w === 'hybrid') return 'hybrid';
  return 'onsite';
}

function placesIn(value: string, out: string[]): void {
  const idx = defaultPlaceIndex();
  const cleaned = value.replace(/\([^)]*\)/g, ' ');
  for (const part of cleaned.split(/\s*(?:\/|,|;|\||\band\b|&|\bor\b|·)\s*|\s{2,}/i)) {
    const p = part.trim().replace(/[.:]+$/, '');
    if (p.length < 3 || p.length > 40 || /^(?:india|remote|pan india)$/i.test(p)) continue;
    if (isKnownPlace(idx, p) && !out.includes(p)) out.push(p);
  }
}

// ---------------------------------------------------------------------------------------------
// apply url

const URL_RE = /(?:https?:\/\/|(?<![\w.@-])(?:www\.)?(?:naukri\.com|linkedin\.com|lnkd\.in|wa\.me|chat\.whatsapp\.com)\/)[^\s<>"')\]]+/gi;

function findUrls(text: string): { url: string; at: number }[] {
  const out: { url: string; at: number }[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    if (url.length > 8) out.push({ url, at: m.index! });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

/** The same criterion stated twice (headline and body) is one criterion; evidence is merged. */
function mergeCriteria(list: Criterion[]): Criterion[] {
  const seen = new Map<string, Criterion>();
  for (const c of list) {
    const { evidence, ...rest } = c as Criterion & { evidence: { start: number; end: number }[] };
    const key = JSON.stringify(rest);
    const prev = seen.get(key) as (Criterion & { evidence: { start: number; end: number }[] }) | undefined;
    if (prev) prev.evidence.push(...evidence);
    else seen.set(key, { ...c, evidence: [...evidence] } as Criterion);
  }
  return [...seen.values()];
}

const EMPTY_FRESHER: FresherResult = { fresher: false, reason: 'no_signal', evidence: [] };

export function parsePastedJob(input: string, opts: ParseOptions = {}): ParsedJob {
  const raw = typeof input === 'string' ? input : '';
  const { lines, text, requirements } = normalise(raw);
  const sharedUrl = typeof opts?.sharedUrl === 'string' && opts.sharedUrl.trim() !== '' ? opts.sharedUrl.trim().slice(0, 2000) : null;
  const evidence: FieldEvidence[] = [];
  const addEv = (field: JobField, h: Hit | null): void => {
    if (h && h.at >= 0 && text.slice(h.at, h.at + h.value.length) === h.value) evidence.push({ field, start: h.at, end: h.at + h.value.length, quote: h.value });
  };

  const { title, company } = extractTitleCompany(lines);
  addEv('title', title);
  addEv('company', company);

  // locations and workplace
  const locations: string[] = [];
  let modeRaw: string | null = null;
  let parenMode: Workplace | null = null;
  for (const l of lines) {
    const lab = labelOf(l.text);
    if (lab && LOC_LABELS.has(lab.label)) {
      placesIn(lab.value, locations);
      parenMode ??= workplaceWord(lab.value);
      continue;
    }
    if (lab && MODE_LABELS.has(lab.label)) {
      modeRaw = lab.value;
      continue;
    }
    if (l.lead.includes('📍')) {
      placesIn(l.text, locations);
      const pm = WORKPLACE_PAREN.exec(l.text);
      if (pm) parenMode ??= workplaceWord(pm[1]!);
    } else if (/\s[·•]\s/.test(l.text) && !l.bullet && l.text.length < 120) {
      const tail = l.text.split(/\s[·•]\s/).slice(1).join(' ');
      placesIn(tail, locations);
      const pm = WORKPLACE_PAREN.exec(tail);
      if (pm) parenMode ??= workplaceWord(pm[1]!);
    } else if (/\b(?:yrs?|years?|lpa)\b|₹/i.test(l.text) && !l.bullet && l.text.length < 120 && locations.length === 0) {
      placesIn(l.text.replace(/[|]/g, '  ').replace(/\b\d[\d.,-]*\s*(?:yrs?|years?|lpa)\b/gi, '  ').replace(/₹\s*[\d.,-]+/g, '  '), locations);
    }
  }
  if (locations.length === 0) {
    for (const l of lines) {
      if (l.bullet || l.kind !== 'p' || l.text.length > 70 || /\d/.test(l.text) || ROLE_RE.test(l.text)) continue;
      const found: string[] = [];
      placesIn(l.text, found);
      if (found.length > 0 && found.length >= l.text.replace(/\([^)]*\)/g, '').split(/\s*(?:\/|,|;|\||&)\s*/).filter((x) => x.trim() && !/^india$/i.test(x.trim())).length) {
        locations.push(...found);
        const pm = WORKPLACE_PAREN.exec(l.text);
        if (pm) parenMode ??= workplaceWord(pm[1]!);
        break;
      }
    }
  }
  const countries = locations.length ? resolveCountries(locations).countries : [];
  for (const loc of locations) {
    const at = text.indexOf(loc);
    if (at >= 0) evidence.push({ field: 'location', start: at, end: at + loc.length, quote: loc });
  }

  const doc = toDoc(text.split('\n').map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join(''));
  const mustYears = requirements.filter((r) => r.kind === 'must' && r.yearsMin !== null).map((r) => r.yearsMin as number);
  const yearsMin = mustYears.length ? Math.max(...mustYears) : null;
  const titleStr = title?.value ?? '';
  const cin = {
    title: titleStr,
    titleNorm: canonicalTitle(titleStr).norm,
    department: null,
    team: null,
    employmentRaw: null,
    workplaceRaw: modeRaw !== null ? (workplaceWord(modeRaw) === 'remote' ? 'Remote' : workplaceWord(modeRaw) === 'hybrid' ? 'Hybrid' : workplaceWord(modeRaw) === 'onsite' ? 'Onsite' : null) : null,
    isRemoteHint: null,
    locationsRaw: locations,
    doc,
    yearsMin,
  };
  const workplace = classifyWorkplace(cin).value ?? parenMode;
  const level = titleStr || yearsMin !== null ? classifyLevel(cin).value : null;

  const criteria = text.trim() === '' ? [] : mergeCriteria(parseCriteria(text));
  const mustReqs = requirements.filter((r) => r.kind === 'must');
  let fresher = text.trim() === '' ? EMPTY_FRESHER : assessFresher({ title: titleStr, level, requirements: mustReqs, text });
  // "0-1 Yrs" on a card means a years band but never says "experience": retry on a copy and point the
  // evidence back at the original spans, so every offset still indexes `text`.
  const BAND = /\b(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\s*yrs?\b/gi;
  if (!fresher.fresher && fresher.reason === 'no_signal' && BAND.test(text)) {
    const alt = assessFresher({ title: titleStr, level, requirements: mustReqs, text: text.replace(BAND, '$1-$2 years of experience') });
    if (alt.fresher) {
      const spans = [...text.matchAll(BAND)].filter((m) => Number(m[1]) <= 1 && Number(m[2]) <= 2);
      fresher = { ...alt, evidence: spans.map((m) => ({ source: 'description' as const, start: m.index!, end: m.index! + m[0].length, quote: m[0] })) };
    }
  }
  // Campus notices say who may apply by passout year or addressing students, with no word "fresher".
  if (!fresher.fresher && fresher.reason === 'no_signal') {
    const passout = criteria.find((c) => c.type === 'passout_years');
    const cue = /\b(?:dear students|pass[- ]?outs?|final[- ]year students?|students of)\b/i.exec(text);
    const span = passout?.evidence[0] ?? (cue ? { start: cue.index, end: cue.index + cue[0].length } : null);
    if (span) fresher = { fresher: true, reason: 'campus_notice', evidence: [{ source: 'description', start: span.start, end: span.end, quote: text.slice(span.start, span.end) }] };
  }

  const salary = text.trim() === '' ? null : parseSalary(text);

  // apply url and source hint (strings only)
  const urls = findUrls(text);
  let applyUrl: string | null = sharedUrl;
  if (!applyUrl) {
    const cued = urls.find((u) => {
      const ls = text.lastIndexOf('\n', u.at) + 1;
      return /apply|link|register|click|here/i.test(text.slice(ls, u.at));
    });
    applyUrl = (cued ?? urls[0])?.url ?? null;
  }
  if (applyUrl) {
    const at = text.indexOf(applyUrl);
    if (at >= 0) evidence.push({ field: 'applyUrl', start: at, end: at + applyUrl.length, quote: applyUrl });
  }
  let sourceHint: SourceHint = sourceHintFromUrl(sharedUrl);
  if (sourceHint === 'other') sourceHint = sourceHintFromUrl(applyUrl);
  if (sourceHint === 'other') for (const u of urls) if ((sourceHint = sourceHintFromUrl(u.url)) !== 'other') break;
  if (sourceHint === 'other') {
    if (/\bnaukri(?:\.com)?\b/i.test(text)) sourceHint = 'naukri';
    else if (/\blinkedin\b|\beasy apply\b/i.test(text)) sourceHint = 'linkedin';
    else if (/\bwhatsapp\b|(?<![A-Za-z])forwarded(?![A-Za-z])|\bshare (?:maximum|max|with)\b|📢|♻/i.test(raw + '\n' + text)) sourceHint = 'whatsapp';
  }

  const scamFlags = detectScamSignals(text, { url: sharedUrl });
  evidence.sort((a, b) => a.start - b.start);
  return { text, title: title?.value ?? null, company: company?.value ?? null, locations, countries, workplace, level, fresher, salary, requirements, criteria, applyUrl, sourceHint, scamFlags, evidence };
}

// ---------------------------------------------------------------------------------------------
// scoring against a student's profile

export interface ProfileFit {
  /** Canonical skill ids the student has evidence for. */
  skillIds: readonly string[];
  cities: readonly string[];
  remote: boolean;
  /** Whole years of experience; defaults to 0. */
  yearsExperience?: number;
}

export interface ScoreOptions {
  /** Injected clock. A pasted job is treated as open and checked at `now`. */
  now: string | number | Date;
  cgpaRule?: CgpaRule;
  /** The student's university rule (data/cgpa-rules.json) and whether they confirmed it. */
  universityRule?: UniversityRule | null;
  universityRuleConfirmed?: boolean;
  /** Scheme or admission year, for universities whose formula depends on it (VTU). */
  universityScheme?: string | null;
  admissionYear?: number | null;
}

export interface JobScore {
  eligibility: EligibilityResult;
  /** Counts only must-haves that can be checked: ones with skills, or a stated years minimum. */
  mustHaves: { matched: number; total: number };
  worthwhile: WorthwhileResult;
  verdict: 'worthwhile' | 'not_worthwhile' | 'suspicious';
  reasons: string[];
}

export function scoreForProfile(job: ParsedJob, profile: ProfileFit, eligibilityProfile: EligibilityProfileInput | null | undefined, opts: ScoreOptions): JobScore {
  if (!opts || opts.now === undefined || opts.now === null) throw new EngineInvariantError('jobtext.now.missing', 'scoreForProfile needs an injected now');
  const have = new Set(profile.skillIds);
  const years = profile.yearsExperience ?? 0;
  let matched = 0;
  let total = 0;
  for (const r of job.requirements) {
    if (r.kind !== 'must') continue;
    if (r.skillIds.length > 0) {
      total++;
      if (r.skillIds.every((s) => have.has(s))) matched++;
    } else if (r.yearsMin !== null) {
      total++;
      if (years >= r.yearsMin) matched++;
    }
  }
  const eligibility = evaluateEligibility(job.criteria, eligibilityProfile, { cgpaRule: opts.cgpaRule ?? null, universityRule: opts.universityRule ?? null, universityRuleConfirmed: opts.universityRuleConfirmed === true, universityScheme: opts.universityScheme ?? null, admissionYear: opts.admissionYear ?? null });
  const worthwhile = isWorthwhile({
    job: {
      fresher: job.fresher.fresher,
      open: true,
      lastCheckedAt: opts.now,
      payStated: job.salary !== null,
      remote: job.workplace === null ? null : job.workplace === 'remote',
      locations: job.locations,
    },
    evidence: { mustMet: matched, mustTotal: total },
    user: { cities: profile.cities, remote: profile.remote },
    now: opts.now,
    eligibility,
  });
  const reasons = worthwhile.conditions.map((c) => `${c.pass ? 'ok' : 'blocked'}: ${c.detail}`);
  reasons.push(worthwhile.info.locationFit ? 'info: location fits your preferences' : 'info: location is outside your preferences');
  reasons.push(worthwhile.info.payStated ? 'info: pay is stated' : 'info: pay is not stated');
  if (job.scamFlags.flagged) reasons.unshift(`warning: ${job.scamFlags.signals.filter((s) => s.severity !== 'low').map((s) => s.id).join(', ')}`);
  const verdict = job.scamFlags.flagged ? 'suspicious' : worthwhile.worthwhile ? 'worthwhile' : 'not_worthwhile';
  return { eligibility, mustHaves: { matched, total }, worthwhile, verdict, reasons };
}
