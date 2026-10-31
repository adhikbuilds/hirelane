/**
 * classifyQuestion: a form question label (and its options) to a known key. Rules only, no LLM.
 * Anything unrecognised is 'unknown'; it is never forced into a known key. Order matters: the first rule that matches wins.
 */
import type { Classification, QuestionKey } from './types';

function clean(raw: string): { full: string; base: string } {
  let s = raw.normalize('NFKC').toLowerCase().replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"');
  s = s.replace(/[*✱]/g, ' ').replace(/\(\s*(?:optional|required|mandatory)\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const base = s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').replace(/[.?:!\s]+$/g, '').trim();
  return { full: s.replace(/[.?:!\s]+$/g, ''), base };
}

const WHY = /\bwhy\b|what (?:attracts|interests|excites|draws|motivates)|what makes you/;
const COMPANY_WORD = /\b(?:company|us|team|organi[sz]ation|here|firm)\b|work (?:at|for|with)\b|join [A-Za-z]/;
const ROLE_WORD = /\b(?:role|position|job|opportunity|fit)\b/;
const TENTH = /\b(?:10th|tenth|class x|std x|standard x|ssc|sslc|matric(?:ulation)?)\b/;
const TWELFTH = /\b(?:12th|twelfth|class xii|std xii|standard xii|hsc|puc|intermediate|plus two|\+2)\b/;

function schoolLevel(full: string): QuestionKey | null {
  const lvl: QuestionKey | null = TENTH.test(full) ? 'pct_10' : TWELFTH.test(full) ? 'pct_12' : null;
  if (!lvl) return null;
  if (/\b(?:year|passing|pass ?out|passout|board|school name|roll)\b/.test(full)) return 'unknown';
  if (/percent|%|marks|score|grade|cgpa|aggregate/.test(full)) return lvl;
  return 'unknown';
}

/** A "why" about leaving, switching or a gap is not a "why this company" question. */
const WHY_LEAVE = /\b(?:leav(?:e|ing)|left|quit|resign\w*|switch\w*|chang(?:e|ed|ing)|gap|laid off|terminat\w*|fired|moving on|drop(?:ped)?)\b/;
const WHY_INTENT = /\b(?:want|wants|wish|like|would like|interested|interest|apply|applying|join|joining|work(?:ing)? (?:at|for|with)|attract\w*|excit\w*|draws?|motivat\w*|choose|chose|fit|good fit|suitable|right for)\b/;

function freeText(full: string): QuestionKey | null {
  if (WHY.test(full)) {
    const short = /^why (?:us|this (?:company|role|position|job))$/.test(full);
    if (WHY_LEAVE.test(full)) return 'unknown';
    if (/\bwhy\b/.test(full) && !short && !WHY_INTENT.test(full)) return 'unknown';
    const role = ROLE_WORD.test(full);
    const company = COMPANY_WORD.test(full);
    if (role && !company) return 'why_role';
    if (company) return 'why_company';
    if (role) return 'why_role';
    return null;
  }
  if (/\b(?:about|introduce|describe) (?:yourself|you\b)|tell (?:us|me)(?: a little)?(?: about)? (?:yourself|you\b|me\b)|(?:short|brief) (?:bio|introduction|intro|summary)\b|^about yourself/.test(full)) return 'about_yourself';
  return null;
}

const ORG_UNKNOWN = [
  /\b(?:reference|referrer|referral|referred by)\b/,
  /\b(?:company|employer|organi[sz]ation|college|university|institute|school) (?:name|email)\b/,
  /\b(?:name of|current|present|previous|last)\b.*\b(?:company|employer|organi[sz]ation|college|university|institute|school)\b/,
  /^(?:company|employer|organi[sz]ation|college|university|institute|school)$/,
  /\balternat(?:e|ive)\b/,
];

const SENSITIVE_ID = /\b(?:father|mother|parents?|guardian|spouse|husband|wife|emergency|aadhaar|aadhar|passport|pan(?: card| number| no)?)\b/;
const EEO = /\b(?:gender|sex|pronouns?|race|ethnic\w*|disabilit\w*|veteran|religion|caste|social category|reserved category|marital|sexual orientation|transgender|date of birth|dob|birth ?date|how old|your age)\b|category \(general/;

function opts(options: readonly string[] | undefined): string[] {
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string').map((o) => o.normalize('NFKC').toLowerCase().trim()) : [];
}

function byLabel(full: string, base: string): QuestionKey {
  const ft = freeText(full);
  if (ft) return ft;
  if (ORG_UNKNOWN.some((r) => r.test(base))) return 'unknown';
  const sl = schoolLevel(full);
  if (sl) return sl;
  if (SENSITIVE_ID.test(base)) return 'sensitive_id';
  if (EEO.test(full)) return 'gender_eeo';
  if (/sponsor/.test(full)) return 'visa_sponsorship';
  if (/authori[sz]ed to work|authori[sz]ation to work|work authori[sz]ation|right to work|work permit|eligible to work|legally (?:allowed|permitted|entitled)|legal right/.test(full)) return 'work_authorization';
  if (/\b(?:current|present|existing|last drawn|latest|drawing)\b.*\b(?:ctc|salary|compensation|package|pay|lpa)\b/.test(full)) return 'current_ctc';
  if (/\b(?:expected|desired|target|expecting)\b.*\b(?:ctc|salary|compensation|pay|package|lpa)\b|\bectc\b|\b(?:salary|compensation|pay|package|ctc) expectations?\b/.test(full)) return 'expected_ctc';
  if (/notice period|\bhow soon (?:can|could|would|will) you (?:join|start)\b|\bwhen (?:can|could|will|would) you (?:join|start|begin)\b|earliest (?:start|joining|date)|joining (?:time|date)|availab\w+ to (?:join|start)|date of joining|start date|days to join/.test(full)) return 'notice_period';
  if (/relocat\w*.*\b(?:assistance|support|bonus|allowance|package|reimburs\w*|expens\w*|help|benefit\w*)\b|\b(?:assistance|support|bonus|allowance|reimburs\w*|expens\w*|help|benefit\w*)\b.*relocat/.test(full)) return 'unknown';
  if (/relocat|(?:willing|open|ready|able) to (?:move|shift)|move to (?:another|a different) city/.test(full)) return 'relocation';
  if (/linked ?in/.test(full)) return 'linkedin';
  if (/git ?hub/.test(full)) return 'github';
  if (/\be-?mail\b/.test(full)) return 'email';
  if (/^(?:your |primary |personal |contact )*(?:phone|mobile|cell ?phone|cell|contact|whatsapp)(?: ?(?:number|no|num|#))?$/.test(base) || /\b(?:phone|mobile|whatsapp|contact|cell) ?(?:number|no|num)\b/.test(base)) return 'phone';
  if (/\b(?:graduation|passing|pass ?out|passout|completion|graduating)\b.*\b(?:year|date)\b|\b(?:year|date) of (?:graduation|passing|passout|completion)\b|^batch(?: year)?$|(?:when|what year|which year) (?:do|will|did) you (?:graduate|complete|pass)|expected graduation/.test(base)) return 'grad_year';
  const c = /\b(?:cgpa|gpa|cpi|grade point)\b/.test(full);
  const p = /percent|%|aggregate|marks/.test(full);
  // A percentage only means the graduation score when the question is about academics: "what percentage of travel ..." is not.
  const academic = /\b(?:graduation|graduate|degree|ug|b ?tech|b ?e|b ?sc|b ?com|b ?a|bca|pg|academic|aggregate|cgpa|gpa|cpi|marks|scored|semester|university|college|engineering|diploma)\b/.test(full);
  if (c && p) return 'cgpa_pct';
  if (c) return 'cgpa';
  if (p && (academic || /aggregate|marks/.test(full))) return 'percentage';
  if (/\bwhen\b|\b(?:start|started|begin|began|finish\w*)\b/.test(base) && /\b(?:degree|qualification|education)\b/.test(base)) return 'unknown';
  if (/\b(?:degree|qualification)\b|education(?:al)? level|level of education/.test(base)) return 'degree';
  if (/^(?:(?:your|candidate|applicant|legal|full|first|last|middle|preferred|given|family|enter|what is your)\s+)*(?:name|surname)(?: as per .*)?$/.test(base)) return 'name';
  return 'unknown';
}

function byOptions(list: string[]): QuestionKey {
  if (list.length === 0) return 'unknown';
  if (list.some((o) => /decline to|prefer not to|do not wish|don't wish|choose not to/.test(o)) || (list.includes('male') && list.includes('female'))) return 'gender_eeo';
  if (list.some((o) => /^immediate/.test(o)) && list.some((o) => /\bdays?\b/.test(o))) return 'notice_period';
  return 'unknown';
}

export function classifyQuestion(label: string, options?: readonly string[]): Classification {
  const o = opts(options);
  if (typeof label !== 'string' || label.length > 600) {
    return { key: 'unknown', via: 'none' };
  }
  const { full, base } = clean(label);
  if (full) {
    const k = byLabel(full, base);
    if (k !== 'unknown') return { key: k, via: 'label' };
  }
  // Options can tip a vague label into EEO or notice period, but never override a recognised trap above.
  if (!full || !ORG_UNKNOWN.some((r) => r.test(base))) {
    const k = byOptions(o);
    if (k !== 'unknown') return { key: k, via: 'options' };
  }
  return { key: 'unknown', via: 'none' };
}
