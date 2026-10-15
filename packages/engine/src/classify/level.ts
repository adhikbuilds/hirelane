/**
 * Seniority level (ordinal). Title rules first, then the years-of-experience band.
 * Precedence among title matches: intern > executive > lead > senior > mid > entry.
 */
import { evidence } from '../internal/tracer';
import { TraceBuilder } from '../trace';
import type { Evidence } from '../trace';
import type { Classified, ClassifyInput } from './types';

export const LEVELS = ['intern', 'entry', 'mid', 'senior', 'lead', 'executive'] as const;
export type Level = (typeof LEVELS)[number];

export function levelDistance(a: Level, b: Level): number {
  return Math.abs(LEVELS.indexOf(a) - LEVELS.indexOf(b));
}

export function toPublicLevel(l: Level): 'intern' | 'entry' | 'mid' | 'experienced' {
  return l === 'senior' || l === 'lead' || l === 'executive' ? 'experienced' : l;
}

interface TitleRule {
  id: string;
  level: Level;
  re: RegExp;
}

const ROLE_NOUN =
  '(?:engineer|developer|analyst|scientist|designer|manager|specialist|associate|consultant|recruiter|accountant|representative|architect|programmer|administrator|researcher|technician|writer|coordinator|executive|strategist|marketer|officer|agent|counsel|attorney|producer|editor|planner|buyer)s?';

// The winner among several matches is chosen by PRIORITY, not by position here.
const RULES: TitleRule[] = [
  { id: 'level.title.intern', level: 'intern', re: /\b(?:intern|interns|internship|internships|co[- ]?op|working student|werkstudent|summer analyst|apprentice(?:ship)?)\b/i },
  { id: 'level.title.executive', level: 'executive', re: /(?<!office of (?:the )?)(?<!\bto (?:the )?)\b(?:vp|svp|evp|avp|vice president|chief [a-z]+(?: [a-z]+)? officer|ceo|cto|cfo|coo|cmo|cio|ciso|cpo|cro|cco|president|managing director|director)\b/i },
  { id: 'level.title.lead', level: 'lead', re: /(?<!technical )(?<!\bto (?:the )?)\b(?:staff|principal|distinguished|lead|head of|manager of managers)\b/i },
  { id: 'level.title.senior', level: 'senior', re: new RegExp(`\\b(?:senior|sr\\.?|snr|${ROLE_NOUN} (?:iii|3|iv|4))(?![\\w.+#])`, 'i') },
  { id: 'level.title.mid', level: 'mid', re: new RegExp(`\\b(?:${ROLE_NOUN} (?:ii|2)|mid[- ]level|intermediate)(?![\\w.+#])`, 'i') },
  {
    id: 'level.title.entry',
    level: 'entry',
    re: new RegExp(
      `\\b(?:new grad(?:uate)?s?|graduate|junior|jr\\.?|entry[- ]level|early career|trainee|associate(?! director| vice| principal| professor)|${ROLE_NOUN} (?:i|1))(?![\\w.+#])`,
      'i',
    ),
  },
];

/** Titles where an otherwise matching word is not a seniority signal. */
const EXCLUSIONS: { id: string; re: RegExp }[] = [
  { id: 'level.exclude.account_executive', re: /\b(?:account|sales|enterprise|channel|territory|customer|solutions?|business|strategic|inside|field|marketing) executives?\b/i },
  { id: 'level.exclude.executive_assistant', re: /\bexecutive (?:assistant|recruiter|coordinator|admin|administrator|support|business partner|producer|chef|secretary)\b/i },
];

const PRIORITY: Level[] = ['intern', 'executive', 'lead', 'senior', 'mid', 'entry'];

function foldLower(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const l = (s[i] as string).toLowerCase();
    out += l.length === 1 ? l : (s[i] as string);
  }
  return out;
}

interface Hit {
  rule: TitleRule;
  start: number;
  end: number;
}

export function classifyLevel(i: ClassifyInput): Classified<Level | null> {
  const tb = new TraceBuilder('level');
  const title = i.title;
  const folded = foldLower(title);
  const hits: Hit[] = [];
  const excluded: { id: string; ev: Evidence }[] = [];
  for (const rule of RULES) {
    const m = new RegExp(rule.re.source, 'i').exec(folded);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    const ex = rule.level === 'executive' || rule.level === 'lead' ? EXCLUSIONS.find((e) => e.re.test(folded)) : undefined;
    if (ex) {
      // "Executive Assistant to the CEO" and "Account Executive, VP Channel" are role names, not executive level.
      excluded.push({ id: ex.id, ev: evidence('title', title, start, end) });
      continue;
    }
    hits.push({ rule, start, end });
  }
  for (const e of excluded) {
    tb.step({
      ruleId: e.id,
      op: 'reject',
      label: `"${e.ev.quote}" is part of a role name, not a seniority signal`,
      inputs: { title },
      output: null,
      evidence: [e.ev],
    });
  }
  if (hits.length > 0) {
    const sorted = [...hits].sort((a, b) => PRIORITY.indexOf(a.rule.level) - PRIORITY.indexOf(b.rule.level));
    const win = sorted[0] as Hit;
    const ev = evidence('title', title, win.start, win.end);
    if (sorted.length > 1) {
      tb.step({
        ruleId: 'level.select.title_conflict',
        op: 'select',
        label: `Title matches ${sorted.map((h) => h.rule.level).join(', ')}; ${win.rule.level} wins`,
        inputs: { candidates: sorted.map((h) => h.rule.level) },
        output: win.rule.level,
        evidence: sorted.map((h) => evidence('title', title, h.start, h.end)),
      });
    }
    tb.step({
      ruleId: win.rule.id,
      op: 'classify',
      label: `Title "${ev.quote}" means ${win.rule.level}`,
      inputs: { title },
      output: win.rule.level,
      evidence: [ev],
    });
    return { value: win.rule.level, evidence: [ev], trace: tb.build('value') };
  }

  if (i.yearsMin !== null) {
    const y = i.yearsMin;
    const level: Level = y <= 1 ? 'entry' : y <= 4 ? 'mid' : y <= 7 ? 'senior' : 'lead';
    tb.step({
      ruleId: 'level.years_band',
      op: 'classify',
      label: `${y}+ years required means ${level} (0-1 entry, 2-4 mid, 5-7 senior, 8+ lead)`,
      inputs: { yearsMin: y },
      output: level,
    });
    return { value: level, evidence: [], trace: tb.build('value') };
  }
  tb.step({ ruleId: 'level.none', op: 'default', label: 'No seniority signal in the title or the requirements', inputs: {}, output: null });
  return { value: null, evidence: [], trace: tb.build('null') };
}
