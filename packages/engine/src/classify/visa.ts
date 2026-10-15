/**
 * Visa sponsorship. `yes` only on an explicit positive phrase. Any negative beats any positive.
 * Rule ids: visa.negative, visa.positive, visa.hedged, visa.question_ignored, visa.conflict_negative_wins, visa.none.
 */
import { evidence } from '../internal/tracer';
import type { Doc } from '../text';
import { TraceBuilder } from '../trace';
import type { Evidence } from '../trace';
import type { Classified } from './types';

export type Visa = 'yes' | 'no' | 'unknown';

const NEGATIVE: RegExp[] = [
  /\b(?:unable|not able|cannot|can't|can not|won't|will not|do not|does not|don't|doesn't|not (?:currently )?(?:able|in a position|willing|permitted)|are not|is not)(?: to)?\s+(?:currently\s+)?(?:be able to\s+)?sponsor/i,
  /\b(?:unable|not able|cannot|can't|can not|won't|will not|do not|does not|don't|doesn't|not)(?: to)?\s+(?:currently\s+)?(?:offer|provide|support|extend|consider)\s+(?:\w+\s+){0,2}?(?:sponsorship|visas?|work permits?)\b/i,
  /\bsponsorship (?:is|are) (?:not|unavailable)(?: available| offered| provided| possible)?\b/i,
  /\bno (?:visa |work |immigration |employment )?(?:sponsorship|sponsor)\b/i,
  /\b(?:authori[sz]ed|eligible|permitted|legally (?:authori[sz]ed|entitled|able)|right) to work\b[^.!?\n]{0,100}?\bwithout (?:(?:the need for|current|future|or future|and)\s+)*(?:visa |employer |immigration )?sponsorship/i,
  /\b(?:not|never)\s+(?:currently\s+)?require\s+(?:\w+\s+){0,3}?sponsorship/i,
  /\b(?:without|not requiring|no need for)\s+(?:current or future\s+|now or in the future\s+)?(?:visa )?sponsorship (?:now or in the future|is required)\b/i,
];

const HEDGED: RegExp[] = [
  /\b(?:may|might|could|potentially)\b[^.!?\n]{0,40}?\bsponsor/i,
  /\bsponsorship (?:may|might|could) be (?:available|offered|provided|considered)\b/i,
  /\bcase[- ]by[- ]case\b/i,
  /\bfor exceptional candidates\b/i,
  /\bdepending on (?:the )?(?:role|candidate|circumstances)\b[^.!?\n]{0,40}?\bsponsor/i,
];

const POSITIVE: RegExp[] = [
  /\bvisa sponsorship (?:is )?(?:available|offered|provided|supported)\b/i,
  /\b(?:we|company|employer) (?:will|can|do|are able to|are happy to|are willing to|are open to|gladly)\s+sponsor/i,
  /\bwe (?:offer|provide|support)\s+(?:visa|immigration|work)(?: and \w+)? (?:sponsorship|support)\b/i,
  /\bopen to sponsoring\b/i,
  /\bh-?1b transfers? (?:are |is )?(?:welcome|supported|accepted|considered)\b/i,
  /\brelocation and visa (?:support|assistance|sponsorship)\b/i,
  /\bsponsor(?:s|ing)? (?:work )?(?:visas?|permits?)\b/i,
  /\bsponsorship (?:is )?available\b/i,
  /\bwill sponsor\b/i,
];

const NEGATION_TOKEN = /^(?:not|no|never|cannot|can't|can't|won't|don't|doesn't|unable|neither|nor|without|isn't|aren't)$/i;

interface Sentence {
  start: number;
  end: number;
}

function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const re = /[.!?]+(?=\s|$)|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + (m[0] === '\n' ? 0 : m[0].length);
    if (text.slice(start, end).trim() !== '') out.push({ start, end });
    start = m.index + m[0].length;
  }
  if (text.slice(start).trim() !== '') out.push({ start, end: text.length });
  return out;
}

const QUESTION_START = /^\s*(?:will|do|does|are|is|have|would|can|could|did)\s+you\b/i;

function firstMatch(res: RegExp[], s: string): { index: number; end: number } | null {
  let best: { index: number; end: number } | null = null;
  for (const r of res) {
    const m = new RegExp(r.source, 'i').exec(s);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, end: m.index + m[0].length };
  }
  return best;
}

/** True when a negation token sits in the 8 tokens before `at` inside the sentence text. */
function negatedBefore(sentence: string, at: number): boolean {
  const before = sentence.slice(0, at).split(/\s+/).filter(Boolean).slice(-8);
  return before.some((w) => NEGATION_TOKEN.test(w.replace(/^[^a-z']+|[^a-z']+$/gi, '')));
}

/** A positive phrase only counts in a sentence that is about visas or work authorisation. */
const VISA_CONTEXT = /visa|immigration|work permit|work authori|employment authori|h-?1b|sponsorship|relocation|sponsor(?:ing)? (?:candidates|applicants|you|employees|talent|international|foreign|non-)/i;

/** Curly quotes to ASCII, one for one, so offsets stay valid: "can’t" must match "can't". */
const foldQuotes = (s: string): string => s.replace(/[\u2018\u2019\u02bc\u0060\u00b4]/g, "'");

export function detectVisa(doc: Doc): Classified<Visa> {
  const tb = new TraceBuilder('visa');
  const neg: Evidence[] = [];
  const pos: Evidence[] = [];
  const hedged: Evidence[] = [];
  const text = doc.text;
  const folded = foldQuotes(text);

  for (const s of sentences(text)) {
    const sent = folded.slice(s.start, s.end);
    if (!/sponsor|visa|immigration|work permit|h-?1b/i.test(sent)) continue;
    const ev = (m: { index: number; end: number }) => evidence('description', text, s.start + m.index, s.start + m.end);
    const question = /\?\s*$/.test(sent.trim()) || (QUESTION_START.test(sent) && /\?/.test(sent));
    if (question) {
      const m = firstMatch([...NEGATIVE, ...HEDGED, ...POSITIVE, /sponsor/i], sent);
      tb.step({
        ruleId: 'visa.question_ignored',
        op: 'reject',
        label: 'Application question about sponsorship ignored',
        inputs: {},
        output: null,
        evidence: [m ? ev(m) : evidence('description', text, s.start, s.end)],
      });
      continue;
    }
    const n = firstMatch(NEGATIVE, sent);
    if (n) {
      neg.push(ev(n));
      continue;
    }
    const h = firstMatch(HEDGED, sent);
    if (h) {
      hedged.push(ev(h));
      continue;
    }
    const p = VISA_CONTEXT.test(sent) ? firstMatch(POSITIVE, sent) : null;
    if (p) {
      if (negatedBefore(sent, p.index)) {
        const e = ev(p);
        neg.push(e);
        tb.step({
          ruleId: 'visa.negative',
          op: 'reject',
          label: `Positive phrase "${e.quote}" is negated within 8 tokens: counted as negative`,
          inputs: { reclassified: true },
          output: 'no',
          evidence: [e],
        });
      } else pos.push(ev(p));
    }
  }

  const push = (ruleId: string, label: string, list: Evidence[], output: string): void => {
    tb.step({ ruleId, op: 'detect', label, inputs: { count: list.length }, output, evidence: list.slice(0, 5) });
  };
  if (neg.length > 0) {
    if (pos.length > 0) {
      tb.step({
        ruleId: 'visa.conflict_negative_wins',
        op: 'select',
        label: 'Both sponsorship and no-sponsorship statements found; the negative wins (conservative)',
        inputs: { negatives: neg.length, positives: pos.length },
        output: 'no',
        evidence: [...neg.slice(0, 3), ...pos.slice(0, 2)],
      });
    }
    push('visa.negative', `Sponsorship is ruled out: "${(neg[0] as Evidence).quote}"`, neg, 'no');
    return { value: 'no', evidence: neg.slice(0, 5), trace: tb.build('value') };
  }
  if (pos.length > 0) {
    push('visa.positive', `Explicit sponsorship statement: "${(pos[0] as Evidence).quote}"`, pos, 'yes');
    return { value: 'yes', evidence: pos.slice(0, 5), trace: tb.build('value') };
  }
  if (hedged.length > 0) {
    push('visa.hedged', `Sponsorship is hedged: "${(hedged[0] as Evidence).quote}"`, hedged, 'unknown');
    return { value: 'unknown', evidence: hedged.slice(0, 5), trace: tb.build('unknown') };
  }
  tb.step({ ruleId: 'visa.none', op: 'default', label: 'No sponsorship statement found', inputs: {}, output: 'unknown' });
  return { value: 'unknown', evidence: [], trace: tb.build('unknown') };
}
