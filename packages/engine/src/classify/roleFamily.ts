/**
 * Role family (27 families plus null). Unassigned is null: there is deliberately no 'other' slug.
 * Rules in order: role.title_lexicon (data/role-families.json, specific before generic), role.department,
 * role.skill_profile (confidence 0.5).
 */
import rolesData from '../../data/role-families.json';
import { EngineInvariantError } from '../errors';
import { evidence } from '../internal/tracer';
import { defaultSkillIndex, skillCategory, type SkillExtraction } from '../skills';
import { TraceBuilder } from '../trace';
import type { Evidence } from '../trace';
import type { Classified, ClassifyInput } from './types';

export const ROLE_FAMILIES = [
  'software-engineer-general', 'software-engineer-frontend', 'software-engineer-backend',
  'software-engineer-fullstack', 'software-engineer-mobile', 'infrastructure-sre', 'security-engineer',
  'data-engineer', 'data-scientist', 'data-analyst', 'ml-engineer', 'research-scientist',
  'qa-test-engineer', 'hardware-embedded', 'solutions-engineer', 'engineering-manager',
  'product-manager', 'design', 'program-manager', 'sales', 'customer-success',
  'marketing', 'operations-strategy', 'finance', 'legal', 'people-recruiting', 'it-corporate-systems',
] as const;
export type RoleFamily = (typeof ROLE_FAMILIES)[number];

interface RawRule {
  id?: string;
  family: string;
  pattern: string;
}
interface Compiled {
  id: string;
  family: RoleFamily;
  re: RegExp;
}

const data = rolesData as unknown as { titleRules: RawRule[]; departmentRules: RawRule[] };
const FAMILY_SET: ReadonlySet<string> = new Set(ROLE_FAMILIES);

function compile(rules: RawRule[], prefix: string): Compiled[] {
  return rules.map((r, n) => {
    if (!FAMILY_SET.has(r.family)) throw new EngineInvariantError('role.data.unknown_family', `role-families.json: unknown family ${r.family}`);
    return { id: r.id ?? `${prefix}${n}`, family: r.family as RoleFamily, re: new RegExp(r.pattern, 'i') };
  });
}
const TITLE_RULES = compile(data.titleRules, 'title');
const DEPT_RULES = compile(data.departmentRules, 'dept');

/** Lowercase, '&' to 'and', punctuation to spaces. Applied to department and team strings. */
function normText(s: string): string {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleEvidence(title: string, matched: string): Evidence {
  const lower = title.toLowerCase();
  const words = matched.trim().split(/\s+/);
  // Try the whole matched phrase, then the longest leading run of its words, then give the whole title.
  for (let n = words.length; n >= 1; n--) {
    const q = words.slice(0, n).join(' ');
    const at = lower.indexOf(q);
    if (at !== -1) return evidence('title', title, at, at + q.length);
  }
  return evidence('title', title, 0, title.length);
}

export function classifyRoleFamily(i: ClassifyInput, skills?: SkillExtraction): Classified<RoleFamily | null> {
  const tb = new TraceBuilder('role_family');
  const t = i.titleNorm;

  for (const r of TITLE_RULES) {
    const m = r.re.exec(t);
    if (!m) continue;
    const ev = titleEvidence(i.title, m[0]);
    tb.step({
      ruleId: 'role.title_lexicon',
      op: 'classify',
      label: `Title "${i.title}" matches ${r.id} (${m[0].trim()}): ${r.family}`,
      inputs: { titleNorm: t, rule: r.id, matched: m[0].trim() },
      output: r.family,
      evidence: [ev],
    });
    return { value: r.family, evidence: [ev], trace: tb.build('value') };
  }
  tb.step({ ruleId: 'role.title_lexicon', op: 'reject', label: 'No title lexicon rule matched', inputs: { titleNorm: t }, output: null });

  const dept = i.department !== null ? normText(i.department) : '';
  const team = i.team !== null ? normText(i.team) : '';
  for (const [src, raw, norm] of [
    ['department', i.department, dept],
    ['team', i.team, team],
  ] as const) {
    if (raw === null || norm === '') continue;
    for (const r of DEPT_RULES) {
      const m = r.re.exec(norm);
      if (!m) continue;
      const ev = evidence(src, raw, 0, raw.length);
      tb.step({
        ruleId: 'role.department',
        op: 'classify',
        label: `${src === 'department' ? 'Department' : 'Team'} "${raw}" matches ${m[0]}: ${r.family}`,
        inputs: { [src]: raw, matched: m[0] },
        output: r.family,
        evidence: [ev],
      });
      return { value: r.family, evidence: [ev], trace: tb.build('value') };
    }
  }

  if (skills && skills.hits.length > 0) {
    const idx = defaultSkillIndex();
    const counts: Record<string, number> = {};
    const ev: Evidence[] = [];
    for (const h of skills.hits) {
      const c = skillCategory(idx, h.id);
      if (c === null) continue;
      counts[c] = (counts[c] ?? 0) + 1;
      if (ev.length < 5 && h.evidence[0]) ev.push(h.evidence[0]);
    }
    const code = (counts.language ?? 0) + (counts.framework ?? 0);
    const infra = (counts.database ?? 0) + (counts.cloud ?? 0);
    let family: RoleFamily | null = null;
    if (code >= 3 && code >= infra) family = 'software-engineer-general';
    else if (infra >= 3) family = 'infrastructure-sre';
    if (family) {
      tb.step({
        ruleId: 'role.skill_profile',
        op: 'classify',
        label: `Dominant skills are ${family === 'software-engineer-general' ? 'languages and frameworks' : 'databases and cloud'}: ${family} at confidence 0.5`,
        inputs: { counts, confidence: 0.5 },
        output: family,
        evidence: ev,
      });
      return { value: family, evidence: ev, trace: tb.build('value') };
    }
  }
  tb.step({ ruleId: 'role.none', op: 'default', label: 'No role family could be assigned', inputs: {}, output: null });
  return { value: null, evidence: [], trace: tb.build('null') };
}
