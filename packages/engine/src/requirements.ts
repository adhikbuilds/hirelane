/**
 * Task 2.5: requirements extraction. Rule-only and deterministic.
 * Sections come from the heading lexicon, items from bullets (paragraphs when a section has none),
 * must/nice from bullet cues then the section default, years/category from fixed rules.
 */
import { defaultSkillIndex, skillCategory, skillIdsInRange, skillOccurrences, type SkillIndex, type SkillOccurrence } from './skills';
import type { Doc } from './text';
import { evidence, TraceBuilder, type Evidence, type Trace } from './trace';

export type ReqKind = 'must' | 'nice';
export type ReqCategory = 'skill' | 'experience' | 'education' | 'language' | 'location' | 'authorization' | 'other';
export type SectionKind = 'requirements' | 'nice' | 'responsibilities' | 'about' | 'benefits' | 'compensation' | 'other';

export interface Section {
  kind: SectionKind;
  /** The heading block. */
  heading: Evidence;
  /** Up to the next heading of the same or a higher rank. */
  body: { start: number; end: number };
  /** 'req.section.requirements_lexicon', 'req.section.nice_lexicon', ... */
  ruleId: string;
}

/** 1:1 with job_requirements columns. ord fixes display order. */
export interface Requirement {
  ord: number;
  kind: ReqKind;
  /** = doc.text.slice(spanStart, spanEnd), the bullet without its marker. */
  text: string;
  category: ReqCategory;
  /** Sorted, restricted to the span. */
  skillIds: string[];
  /** Integer. */
  yearsMin: number | null;
  spanStart: number;
  spanEnd: number;
  /** null means it came from the no-section fallback. */
  section: SectionKind | null;
  extractor: 'rule' | 'llm';
  confidence: number;
  /** Every rule that shaped this item: kind, category, years. */
  ruleIds: string[];
}

export interface RequirementsResult {
  sections: Section[];
  /** Document order. */
  requirements: Requirement[];
  /** No requirements/nice section found, OR 0 must items. */
  lowConfidence: boolean;
  trace: Trace;
}

/** Injectable annotator for callers that bring their own skill matcher. */
export type SkillAnnotator = (doc: Doc) => { hits: readonly { id: string; evidence: readonly { start: number; end: number }[] }[] };

// ---------------------------------------------------------------------------------------------
// headings

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[…:]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

const COMPENSATION_RE = /\b(?:compensation|salary|pay (?:range|transparency)|pay$|base pay|total rewards|remuneration)\b/;
const BENEFITS_RE = /\b(?:benefits?|perks|what we offer|what you(?:'ll| will) get|why you(?:'ll| will) love|what you will have at|what's in it for you|what you can expect from us)\b/;
const NICE_RE =
  /\b(?:nice[- ]to[- ]haves?|bonus(?: points| qualifications)?|preferred|we prefer|prefer\b|desirable|even better|great if|added plus|a plus|pluses|not required|optional|extra credit|may also have|also have|strong candidates may|what we(?:'d| would)? value|what we value)\b/;
const REQUIREMENTS_RE = new RegExp(
  [
    'qualif', 'requirement', 'looking for', "what you(?:'ll)? (?:bring|need|have)", "^you (?:bring|have|need|are|should have|might be|may be|may thrive|'ll need)\\b",
    "you'll (?:bring|need|fit)", 'who you (?:are|might)', 'about you', 'your background', 'must[- ]have', 'what we (?:look|require|expect|need)',
    "we'd love to hear", 'to excel', 'how to be successful', '(?:great|good|right) fit', 'a fit', 'ideal candidate', 'fit right in', '(?:required|key|technical|core|relevant) skills', 'skills (?:and|&) (?:experience|qualifications)', 'skills required',
    '^experience', '^education', '^basic', '^minimum', 'what do we need', "you(?:'ll| will) have", 'you may thrive', 'thrive in this role', 'your profile',
    'candidate profile', 'success in this role', "who we're looking", 'what makes you',
  ].join('|'),
);
const RESP_ANCHORED_RE = new RegExp(
  [
    "^what you(?:'ll| will) (?:do|be doing|achieve|own|work on|cook up|be working on)", '^(?:key |core )?responsibilit', '^in this role', '^the role$', '^your (?:role|impact|mission|responsibilities)',
    "^you(?: will|'ll)(?:$| (?:do|be (?:doing|working)|own|lead|work|drive|build|help))", 'day[- ]in[- ]the[- ]life', 'on a typical day', '^the impact you', '^the opportunity', '^example projects', ', you will$', 'key duties',
    '^duties', '^role (?:overview|summary)', '^position summary', '^overview$', '^job description',
  ].join('|'),
);
const ABOUT_RE = /^about\b|^who we are|^company overview/;

const NOT_A_LIST_RE = /\b(?:statement|policy|notice|disclaimer|accommodations?|privacy|equal (?:opportunity|employment)|eeo|commitment|how to apply|apply today|interview(?:ing)?|referral|fraudulent|recruiting)\b/;

export function classifyHeading(text: string): { kind: SectionKind; ruleId: string } {
  const h = norm(text);
  const mk = (kind: SectionKind, lex = true) => ({ kind, ruleId: lex ? `req.section.${kind}_lexicon` : 'req.section.other_default' });
  if (NOT_A_LIST_RE.test(h)) return mk('other', false);
  if (COMPENSATION_RE.test(h)) return mk('compensation');
  if (BENEFITS_RE.test(h)) return mk('benefits');
  if (RESP_ANCHORED_RE.test(h)) return mk('responsibilities');
  if (NICE_RE.test(h)) return mk('nice');
  if (REQUIREMENTS_RE.test(h)) return mk('requirements');
  if (ABOUT_RE.test(h)) return mk('about');
  return mk('other', false);
}

// ---------------------------------------------------------------------------------------------
// years

const WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20,
};
const NUMW = '\\d{1,2}|' + Object.keys(WORDS).join('|');
const YEARS_RE = new RegExp(`(?<![\\w.$£€])(${NUMW})(?:\\s*(?:-|–|—|to)\\s*(?:${NUMW})?)?\\s*\\+?\\s*(?:years?|yrs?)(?![A-Za-z])(?:['’]s?)?`, 'gi');
const EXP_NOUN = /^(?:experience|experienced|expertise|work|working|practice|professional|industry|career|background|tenure|hands-on|record|proven|relevant|prior|previous|related|direct|progressive|post-?(?:graduate|qualification)|full-?time)$/;
const LEAD_VERB = /^(?:in|as|with|using|managing|leading|building|developing|designing|selling|programming|coding|writing|operating|running|delivering|supporting|administering|doing|owning|scaling|engineering|analyzing|analysing|performing|conducting)$/;
const NOT_EXPERIENCE = /^(?:old|ago|since)$/;

function numOf(tok: string): number {
  const t = tok.toLowerCase();
  return /^\d/.test(t) ? Number(t) : WORDS[t]!;
}

/** First "N+ years" style statement that is followed by an experience noun. Offsets are into `span`. */
export function parseYearsMin(span: string): { years: number; evidence: Evidence } | null {
  YEARS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = YEARS_RE.exec(span)) !== null) {
    const end = m.index + m[0].length;
    const tokens = span
      .slice(end, end + 80)
      .toLowerCase()
      .split(/[\s,;:()/]+/)
      .filter((t) => t !== '')
      .slice(0, 8);
    const first = tokens[0] ?? '';
    if (NOT_EXPERIENCE.test(first)) continue;
    const ok = LEAD_VERB.test(first) || /^[a-z]{3,}ing$/.test(first) || tokens.slice(0, 6).some((t) => EXP_NOUN.test(t));
    if (!ok) continue;
    const years = numOf(m[1]!);
    if (!Number.isInteger(years) || years < 0) continue;
    return { years, evidence: evidence('description', span, m.index, end) };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// kind and category

const NICE_CUE = /\b(?:a plus|nice[- ]to[- ]haves?|bonus|ideally|preferably|preferred|preferable|an advantage|an asset|an added)\b|\bdesired\W*$/i;
const MUST_CUE = /(?<![A-Za-z])(?:must|required|requires?|minimum|min\.|at least|mandatory|essential)(?![A-Za-z])/i;
const STRONG_MUST = /(?<![A-Za-z])(?:must|minimum|min\.|at least)(?![A-Za-z])/i;

function stripParens(text: string): string {
  return text.replace(/(?<=\S\s)\([^)]*\)/g, ' ');
}

interface KindDecision {
  kind: ReqKind;
  ruleId: string;
  confidence: number;
}

function decideKind(text: string, section: 'requirements' | 'nice'): KindDecision {
  const cue = stripParens(text);
  const nice = NICE_CUE.exec(cue);
  const must = MUST_CUE.exec(cue);
  if (nice && must) {
    const strong = STRONG_MUST.exec(cue);
    if (strong && strong.index < nice.index) return { kind: 'must', ruleId: 'req.kind.cue_conflict', confidence: 0.8 };
    return { kind: 'nice', ruleId: 'req.kind.cue_nice', confidence: 0.95 };
  }
  if (nice) return { kind: 'nice', ruleId: 'req.kind.cue_nice', confidence: 0.95 };
  if (must) return { kind: 'must', ruleId: 'req.kind.cue_must', confidence: 0.95 };
  return section === 'requirements'
    ? { kind: 'must', ruleId: 'req.kind.section_default_must', confidence: 0.85 }
    : { kind: 'nice', ruleId: 'req.kind.section_default_nice', confidence: 0.85 };
}

const LANGUAGES = 'English|German|French|Spanish|Portuguese|Italian|Dutch|Japanese|Mandarin|Cantonese|Chinese|Korean|Hindi|Arabic|Russian|Polish|Swedish|Turkish|Hebrew|Vietnamese|Thai|Indonesian|Tagalog';
const AUTHORIZATION_RE = /\b(?:work(?:ing)? authori[sz]ation|authori[sz]ation to work|authori[sz]ed to work|legally (?:authori[sz]ed|eligible|permitted) to work|eligib\w* to work|right to work|sponsorship|sponsor(?:ed)? (?:a )?visa|visas?|work (?:permit|visa)|citizen(?:ship|s)?|permanent residen\w+|green card|security clearance|clearance|export control)\b/i;
const EDU_I = /\b(?:degrees?|bachelor(?:'s|’s)?|master(?:'s|’s)?|phd|ph\.d\.?|doctorate|diploma|high school|undergraduate|coursework)\b/i;
const EDU_CS = /\b(?:BS|MS|MBA|BA|BSc|MSc|JD|J\.D\.|B\.S\.|M\.S\.|B\.Tech|M\.Tech)\b/;
const LANGUAGE_CUE = /\b(?:fluent|fluency|bilingual|multilingual|native|proficien\w+|written and (?:verbal|spoken)|verbal and written|spoken)\b/i;
const LANGUAGE_NAME = new RegExp(`\\b(?:${LANGUAGES})\\b`);
const LOCATION_RE = /\b(?:based in|located in|must reside|reside in|resides in|relocat\w+|on-?site in|in-?office|in-?person|work (?:from|out of) (?:our|the) \w+ office|hybrid)\b/i;

function categorise(text: string, yearsMin: number | null, nonSoftSkills: number): ReqCategory {
  if (AUTHORIZATION_RE.test(text)) return 'authorization';
  if (EDU_I.test(text) || EDU_CS.test(text)) return 'education';
  if ((LANGUAGE_CUE.test(text) && LANGUAGE_NAME.test(text)) || /\bbilingual\b/i.test(text)) return 'language';
  if (LOCATION_RE.test(text)) return 'location';
  if (yearsMin !== null) return 'experience';
  if (nonSoftSkills > 0) return 'skill';
  return 'other';
}

// ---------------------------------------------------------------------------------------------
// extraction

interface Candidate {
  start: number;
  end: number;
  bullet: boolean;
  instance: number;
  kind: 'requirements' | 'nice';
}

const FALLBACK_RE = /\d+\+?\s*(?:years|yrs)|experience (?:with|in)/i;

export function extractRequirements(doc: Doc, skills?: SkillIndex | SkillAnnotator): RequirementsResult {
  const tb = new TraceBuilder('requirements');
  const sections: Section[] = [];

  // pass 1: classify headings and compute section bodies
  const heads: { block: number; level: number; kind: SectionKind; ruleId: string }[] = [];
  doc.blocks.forEach((b, i) => {
    if (b.kind !== 'heading') return;
    const c = classifyHeading(doc.text.slice(b.start, b.end));
    heads.push({ block: i, level: b.level, kind: c.kind, ruleId: c.ruleId });
  });
  heads.forEach((h, hi) => {
    const b = doc.blocks[h.block]!;
    let bodyEnd = doc.text.length;
    for (let j = hi + 1; j < heads.length; j++) {
      if (heads[j]!.level <= h.level) {
        bodyEnd = doc.blocks[heads[j]!.block]!.start;
        break;
      }
    }
    const heading = evidence('description', doc.text, b.start, b.end);
    sections.push({ kind: h.kind, heading, body: { start: b.end, end: bodyEnd }, ruleId: h.ruleId });
    tb.step({
      ruleId: h.ruleId,
      op: 'detect',
      label: `Heading "${heading.quote}" is a ${h.kind === 'other' ? 'section the engine does not read' : h.kind + ' section'}`,
      inputs: { level: h.level },
      output: h.kind,
      evidence: [heading],
    });
  });

  // pass 2: walk blocks with a heading stack and collect candidates per section instance
  const stack: { level: number; kind: SectionKind; instance: number }[] = [];
  const effective = (): { kind: SectionKind; instance: number } | null => {
    const top = stack[stack.length - 1];
    if (!top) return null;
    if (top.kind !== 'other') return { kind: top.kind, instance: top.instance };
    // A minor unclassified label (a "Technical details:" colon line) inherits from a requirements parent.
    if (top.level >= 5) {
      for (let i = stack.length - 2; i >= 0; i--) {
        const s = stack[i]!;
        if (s.kind === 'other') continue;
        return s.kind === 'requirements' ? { kind: s.kind, instance: s.instance } : null;
      }
    }
    return null;
  };
  const cands: Candidate[] = [];
  const instancesWithBulletsDeep = new Set<number>();
  let hi = 0;
  doc.blocks.forEach((b) => {
    if (b.kind === 'heading') {
      const h = heads[hi]!;
      while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) stack.pop();
      stack.push({ level: h.level, kind: h.kind, instance: hi });
      hi++;
      return;
    }
    const eff = effective();
    if (!eff || (eff.kind !== 'requirements' && eff.kind !== 'nice')) return;
    cands.push({ start: b.start, end: b.end, bullet: b.kind === 'bullet', instance: eff.instance, kind: eff.kind });
    if (b.kind === 'bullet') for (const s of stack) instancesWithBulletsDeep.add(s.instance);
  });
  const instancesWithBullets = instancesWithBulletsDeep;
  const chosen = cands.filter((c) => c.bullet || !instancesWithBullets.has(c.instance));

  // skills restricted to spans
  let occs: SkillOccurrence[] | null = null;
  let annotate: SkillAnnotator | null = null;
  if (typeof skills === 'function') annotate = skills;
  else occs = skillOccurrences(doc, skills ?? defaultSkillIndex());
  const index = typeof skills === 'function' ? null : (skills ?? defaultSkillIndex());
  const annotated = annotate ? annotate(doc) : null;
  const skillsIn = (start: number, end: number): { ids: string[]; nonSoft: number } => {
    if (annotated) {
      const ids = [...new Set(annotated.hits.filter((h) => h.evidence.some((e) => e.start >= start && e.end <= end)).map((h) => h.id))].sort();
      return { ids, nonSoft: ids.length };
    }
    const ids = skillIdsInRange(occs!, start, end);
    return { ids, nonSoft: ids.filter((id) => skillCategory(index!, id) !== 'soft').length };
  };

  const requirements: Requirement[] = [];
  const emit = (start: number, end: number, kind: ReqKind, kindRule: string, confidence: number, section: SectionKind | null, extraRules: string[]): void => {
    const text = doc.text.slice(start, end);
    const years = parseYearsMin(text);
    const sk = skillsIn(start, end);
    const category = categorise(text, years?.years ?? null, sk.nonSoft);
    const ruleIds = [...extraRules, kindRule, ...(years ? ['req.years.min'] : []), `req.category.${category}`];
    const ev = [evidence('description', doc.text, start, end)];
    requirements.push({ ord: requirements.length, kind, text, category, skillIds: sk.ids, yearsMin: years ? years.years : null, spanStart: start, spanEnd: end, section, extractor: 'rule', confidence, ruleIds });
    tb.step({
      ruleId: kindRule,
      op: 'classify',
      label: `${kind === 'must' ? 'Must have' : 'Nice to have'}: ${text.length > 80 ? text.slice(0, 77) + '...' : text}`,
      inputs: { kind, category, yearsMin: years ? years.years : null, section },
      output: { ord: requirements.length - 1, kind, category },
      evidence: ev,
    });
  };

  const isLabelOnly = (t: string): boolean => /:\s*$/.test(t) && t.split(/\s+/).length <= 3;
  for (const c of chosen) {
    const t = doc.text.slice(c.start, c.end);
    if (isLabelOnly(t) || t.length < 1) continue;
    const d = decideKind(t, c.kind);
    emit(c.start, c.end, d.kind, d.ruleId, d.confidence, c.kind, []);
  }

  const hasReqSection = sections.some((s) => s.kind === 'requirements' || s.kind === 'nice');
  if (!hasReqSection) {
    for (const b of doc.blocks) {
      if (b.kind !== 'bullet') continue;
      const t = doc.text.slice(b.start, b.end);
      if (FALLBACK_RE.test(t) && !isLabelOnly(t)) emit(b.start, b.end, 'must', 'req.kind.fallback_must', 0.5, null, ['req.fallback.experience_bullet']);
    }
    tb.step({ ruleId: 'req.fallback.no_section', op: 'default', label: 'No requirements section found; kept only bullets that state experience', inputs: { items: requirements.length }, output: requirements.length });
  }
  const lowConfidence = !hasReqSection || !requirements.some((r) => r.kind === 'must');
  if (lowConfidence) tb.step({ ruleId: 'req.low_confidence', op: 'default', label: 'Low confidence: an LLM fallback is eligible', inputs: { sections: hasReqSection }, output: true });

  return { sections, requirements, lowConfidence, trace: tb.build(requirements.length > 0 ? 'value' : 'null') };
}
