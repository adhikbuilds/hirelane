/**
 * Workplace: remote | hybrid | onsite.
 * Rules in order: structured ATS field, remote in a location string, mode word in a location string,
 * description phrase, then the isRemote hint (confidence 0.6). A hint never beats anything else.
 */
import { evidence } from '../internal/tracer';
import { TraceBuilder } from '../trace';
import type { Evidence } from '../trace';
import type { Classified, ClassifyInput } from './types';

export type Workplace = 'remote' | 'hybrid' | 'onsite';

const STRUCTURED: Readonly<Record<string, Workplace | null>> = {
  remote: 'remote',
  hybrid: 'hybrid',
  onsite: 'onsite',
  inoffice: 'onsite',
  office: 'onsite',
  inperson: 'onsite',
  unspecified: null,
  none: null,
  other: null,
};

const REMOTE_LOC = /\b(?:remote|remotely|work from home|wfh|home[- ]based|telecommute)\b/i;
const HYBRID_LOC = /\bhybrid\b/i;
const ONSITE_LOC = /\b(?:on[- ]?site|in[- ]?office|in[- ]person|office[- ]based)\b/i;

interface Phrase {
  id: string;
  value: Workplace;
  re: RegExp;
}
const PHRASES: Phrase[] = [
  {
    id: 'workplace.description_phrase.remote',
    value: 'remote',
    re: /\b(?:fully|100%|completely|entirely|totally)[ -]remote\b|\bremote[- ]first\b|\bthis is a (?:fully )?remote (?:position|role|job|opportunity)\b|\bremote[- ]only\b|\bwork(?:ing)? (?:fully )?remotely\b|\bwork from (?:home|anywhere)\b/i,
  },
  {
    id: 'workplace.description_phrase.hybrid',
    value: 'hybrid',
    re: /\bhybrid (?:work|working|role|position|schedule|model|environment|setup|arrangement|opportunity|office)\b|\b(?:this|the) (?:role|position) is hybrid\b|\b(?:one|two|three|four|[1-4])(?:-(?:one|two|three|four|[1-5]))? days?(?: (?:a|per|each) week)?[ /]*(?:in|at|from) (?:the |our |an? )?(?:[A-Za-z]+ )?(?:office|hq|headquarters)\b|\b(?:onsite|on-site|in[- ]office|in office) (?:\w+ ){0,2}?(?:one|two|three|four|[1-4])(?:-(?:one|two|three|four|[1-5]))? days?\b/i,
  },
  {
    id: 'workplace.description_phrase.onsite',
    value: 'onsite',
    re: /\bin[- ]office (?:role|position|presence|company|culture|work|environment|requirement|only|full[- ]time)\b|\bon[- ]site (?:position|role|job|only|required|presence|work|full[- ]time)\b|\b(?:five|5) days(?: (?:a|per|each) week)?[ /]*(?:in|at|from) (?:the |our |an? )?(?:[A-Za-z]+ )?(?:office|hq|headquarters)\b|\bmust (?:work|be) (?:on[- ]?site|in[- ]office|in the office)\b|\bthis (?:role|position) is (?:on[- ]?site|in[- ]office|office[- ]based)\b|\brequires an? (?:in[- ]office|on[- ]?site) presence\b/i,
  },
];

const key = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');

export function classifyWorkplace(i: ClassifyInput): Classified<Workplace | null> {
  const tb = new TraceBuilder('workplace');
  const losers: { source: string; value: Workplace; ev: Evidence }[] = [];

  // 1. Structured.
  let structured: { value: Workplace; ev: Evidence } | null = null;
  if (i.workplaceRaw !== null) {
    const k = key(i.workplaceRaw);
    if (k in STRUCTURED) {
      const v = STRUCTURED[k] as Workplace | null;
      if (v === null) {
        tb.step({
          ruleId: 'workplace.structured_no_signal',
          op: 'reject',
          label: `Structured workplace "${i.workplaceRaw}" carries no signal`,
          inputs: { workplaceRaw: i.workplaceRaw },
          output: null,
          evidence: [evidence('workplace_raw', i.workplaceRaw, 0, i.workplaceRaw.length)],
        });
      } else structured = { value: v, ev: evidence('workplace_raw', i.workplaceRaw, 0, i.workplaceRaw.length) };
    } else {
      tb.step({
        ruleId: 'workplace.structured_unknown',
        op: 'reject',
        label: `Structured workplace "${i.workplaceRaw}" is not recognised`,
        inputs: { workplaceRaw: i.workplaceRaw },
        output: null,
        evidence: [evidence('workplace_raw', i.workplaceRaw, 0, i.workplaceRaw.length)],
      });
    }
  }

  // 2. Locations.
  type Sig = { value: Workplace; ev: Evidence };
  const locRemotes: Sig[] = [];
  const locModes: Sig[] = [];
  i.locationsRaw.forEach((loc, index) => {
    const r = REMOTE_LOC.exec(loc);
    const h = HYBRID_LOC.exec(loc);
    const o = ONSITE_LOC.exec(loc);
    if (r && !h) locRemotes.push({ value: 'remote', ev: evidence('location', loc, r.index, r.index + r[0].length, { index }) });
    if (h) locModes.push({ value: 'hybrid', ev: evidence('location', loc, h.index, h.index + h[0].length, { index }) });
    else if (o) locModes.push({ value: 'onsite', ev: evidence('location', loc, o.index, o.index + o[0].length, { index }) });
  });
  const locRemote = locRemotes[0] ?? null;
  const locMode = locModes[0] ?? null;

  // 3. Description phrase: first in document order.
  const descHits: { value: Workplace; ruleId: string; ev: Evidence }[] = [];
  for (const p of PHRASES) {
    const m = new RegExp(p.re.source, 'i').exec(i.doc.text);
    if (m) descHits.push({ value: p.value, ruleId: p.id, ev: evidence('description', i.doc.text, m.index, m.index + m[0].length) });
  }
  descHits.sort((a, b) => a.ev.start - b.ev.start);
  const desc = descHits[0] ?? null;

  const candidates: { ruleId: string; value: Workplace; ev: Evidence }[] = [];
  if (structured) candidates.push({ ruleId: 'workplace.structured', ...structured });
  if (locRemote) candidates.push({ ruleId: 'workplace.location_remote', ...locRemote });
  if (locMode) candidates.push({ ruleId: 'workplace.location_mode', ...locMode });
  if (desc) candidates.push({ ruleId: desc.ruleId, value: desc.value, ev: desc.ev });

  if (candidates.length > 0) {
    const win = candidates[0] as (typeof candidates)[number];
    for (const c of candidates.slice(1)) if (c.value !== win.value) losers.push({ source: c.ruleId, value: c.value, ev: c.ev });
    if (losers.length > 0) {
      tb.step({
        ruleId: 'workplace.select',
        op: 'select',
        label: `${win.ruleId} says ${win.value}; lower-precedence signals disagree: ${losers.map((l) => `${l.source}=${l.value}`).join(', ')}`,
        inputs: { winner: win.ruleId, losers: losers.map((l) => ({ rule: l.source, value: l.value })) },
        output: win.value,
        evidence: [win.ev, ...losers.map((l) => l.ev)],
      });
    }
    if (i.isRemoteHint === true && win.value !== 'remote') {
      tb.step({
        ruleId: 'workplace.remote_hint_ignored',
        op: 'reject',
        label: `isRemote hint ignored because ${win.ruleId} says ${win.value}`,
        inputs: { isRemoteHint: true },
        output: win.value,
      });
    }
    tb.step({
      ruleId: win.ruleId,
      op: 'classify',
      label: `"${win.ev.quote}" means ${win.value}`,
      inputs: { source: win.ev.source },
      output: win.value,
      evidence: [win.ev],
    });
    return { value: win.value, evidence: [win.ev], trace: tb.build('value') };
  }

  // 4. Hint.
  if (i.isRemoteHint === true) {
    tb.step({
      ruleId: 'workplace.remote_hint',
      op: 'classify',
      label: 'isRemote flag is the only signal: remote at confidence 0.6',
      inputs: { isRemoteHint: true, confidence: 0.6 },
      output: 'remote',
      evidence: [{ source: 'remote_hint', start: 0, end: 0, quote: '' }],
    });
    return { value: 'remote', evidence: [{ source: 'remote_hint', start: 0, end: 0, quote: '' }], trace: tb.build('value') };
  }
  tb.step({ ruleId: 'workplace.none', op: 'default', label: 'No workplace signal', inputs: {}, output: null });
  return { value: null, evidence: [], trace: tb.build('null') };
}
