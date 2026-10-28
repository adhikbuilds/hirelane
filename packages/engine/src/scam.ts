/**
 * Scam signals for pasted job posts and drive notices (PRD S5a / S6). Pure, rule-only, 0 LLM calls.
 * URLs are only parsed as strings and are never fetched. Offsets are UTF-16 code units into `text`
 * as given; signals that come from an option (senderEmail, url) carry null offsets.
 *
 * risk: none < low < medium < high. `flagged` means risk >= medium. A lone urgency phrase is low
 * (real drives say "last date" and "limited seats"); a medium plus anything else escalates to high.
 */
import { ANNUAL_FACTOR, parseSalary } from './salary';

export type ScamSignalId =
  | 'fee.upfront'
  | 'fee.offer_letter'
  | 'contact.chat_only'
  | 'sender.freemail'
  | 'pressure.urgency'
  | 'pay.unrealistic'
  | 'link.shortened';
export type ScamSeverity = 'low' | 'medium' | 'high';
export type ScamRisk = 'none' | ScamSeverity;

export interface ScamSignal {
  id: ScamSignalId;
  severity: ScamSeverity;
  /** Offsets into the input text; null when the signal comes from an option. */
  start: number | null;
  end: number | null;
  quote: string;
  source: 'text' | 'senderEmail' | 'url';
}

export interface ScamResult {
  signals: ScamSignal[];
  risk: ScamRisk;
  flagged: boolean;
}

export interface ScamOptions {
  senderEmail?: string | null;
  url?: string | null;
}

/** A fresher paid at or above this INR annual figure trips pay.unrealistic. */
export const FRESHER_UNREALISTIC_ANNUAL_INR = 2_000_000;
/** With "no skills / work from home / typing" cues the bar drops to this INR annual figure. */
export const LOW_SKILL_UNREALISTIC_ANNUAL_INR = 600_000;
const MAX_TEXT = 200_000;

export const FREE_MAIL_DOMAINS: readonly string[] = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'rediffmail.com', 'rediff.com', 'proton.me', 'protonmail.com', 'icloud.com', 'aol.com'];
export const URL_SHORTENER_HOSTS: readonly string[] = ['bit.ly', 'tinyurl.com', 't.ly', 'cutt.ly', 'rb.gy', 'goo.gl', 'is.gd', 'shorturl.at', 'ow.ly', 'tiny.cc', 'bit.do', 'rebrand.ly', 'v.gd', 's.id', 'clck.ru', 't.co', 'shorte.st', 'urlz.fr'];
/** Hosts that say nothing about a company's own domain. */
const NON_COMPANY_HOSTS = ['naukri.com', 'linkedin.com', 'lnkd.in', 'indeed.com', 'internshala.com', 'unstop.com', 'foundit.in', 'glassdoor.com', 'wellfound.com', 'whatsapp.com', 'wa.me', 't.me', 'telegram.me', 'telegram.org', 'forms.gle', 'google.com', 'facebook.com', 'instagram.com', 'youtube.com', 'x.com', 'twitter.com'];
const CHAT_HOSTS = ['t.me', 'telegram.me', 'wa.me', 'whatsapp.com'];

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SHORT_SRC = `(?<![\\w.@-])(?:https?:\\/\\/)?(?:www\\.)?(?:${URL_SHORTENER_HOSTS.map(escRe).join('|')})\\/[\\w~%-]+`;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8})/g;
const BARE_HOST_RE = /(?<![\w@.-])(?:[a-z0-9-]{1,63}\.){1,8}(?:com|in|co\.in|org|net|io|ai|tech|test)(?![\w@-])/gi;
const CHAT_LINK_SRC = '(?<![\\w.@-])(?:https?:\\/\\/)?(?:t\\.me|telegram\\.me|wa\\.me|chat\\.whatsapp\\.com)\\/[\\w+-]+';

const hostOf = (u: string): string => {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([^/:?#\s]+)/i.exec(u.trim());
  return m ? m[1]!.toLowerCase().replace(/^www\./, '') : '';
};
const hostIn = (host: string, list: readonly string[]): boolean => list.some((d) => host === d || host.endsWith('.' + d));

function sentenceBounds(text: string, at: number): [number, number] {
  let s = at;
  while (s > 0 && !/[.!?\n]/.test(text[s - 1]!)) s--;
  let e = at;
  while (e < text.length && !/[.!?\n]/.test(text[e]!)) e++;
  return [s, e];
}

// Assurance language near a fee word: "no registration fee", "never ask for a deposit", "free of cost".
const NEG_BEFORE = /\b(?:no|never|nil|zero|without|not|neither|nor|free)\b[^.!?\n]{0,60}$/i;
const NEG_AFTER = /^[^.!?\n]{0,40}?\b(?:free|nil|waived|not (?:required|applicable|charged|collected|asked))\b/i;
const FREE_SENTENCE = /\bfree of (?:cost|charge)\b|\bfor free\b|\bcompletely free\b|\bno (?:fee|fees|charges?|payment|money|cost)\b|\bnever (?:ask|charge|collect|take|demand)\b/i;

function negated(text: string, start: number, end: number): boolean {
  const [s, e] = sentenceBounds(text, start);
  if (FREE_SENTENCE.test(text.slice(s, e))) return true;
  if (NEG_BEFORE.test(text.slice(Math.max(s, start - 80), start))) return true;
  return NEG_AFTER.test(text.slice(end, Math.min(e, end + 60)));
}

const FEE_NOUN = '(?:fee|fees|charge|charges|deposit|amount)';
const FEE_KIND = '(?:registration|training|security|joining|processing|documentation|confirmation|verification|admission|enrol+ment|interview|laptop|kit|id card|booking|seat|refundable|application|course|certification|onboarding)';
const AMOUNT = '(?:rs\\.?|inr|₹)\\s*[\\d,]+(?:\\.\\d+)?(?:\\s*(?:/-|only|k))?';
const FEE_SRCS: string[] = [
  `\\b${FEE_KIND}\\s+${FEE_NOUN}\\b`,
  `\\b(?:security|refundable)\\s+deposit\\b`,
  `\\brefundable\\s+amount\\b`,
  `\\b(?:pay|paying|deposit|transfer|remit|send)\\b[^.!?\\n]{0,30}?${AMOUNT}[^.!?\\n]{0,50}?\\b(?:registration|training|security|joining|processing|kit|seat|slot|booking|verification|laptop|id card|enrol+ment|confirmation|fee|fees|charges?|deposit)\\b`,
  `\\b(?:pay|deposit|transfer)\\b[^.!?\\n]{0,15}?${AMOUNT}\\s+(?:as|towards|for)\\s+(?:a |the )?${FEE_KIND}\\b`,
  `\\b(?:pay|paying|deposit|transfer|remit)\\b[^.!?\\n]{0,15}?${AMOUNT}[^.!?\\n]{0,15}?\\bregistration\\b`,
];
const OFFER_SRCS: string[] = [
  '\\b(?:pay|paying|payment|charges?|fees?|transfer|deposit|amount)\\b[^.!?\\n]{0,90}?\\b(?:offer|appointment|joining|confirmation) letter\\b',
  '\\b(?:offer|appointment|joining|confirmation) letter\\b[^.!?\\n]{0,90}?\\b(?:pay|paying|payment|charges?|fees?|transfer|deposit)\\b',
];
const URGENCY_SRCS: string[] = [
  '\\blimited seats?\\b',
  '\\bonly\\s+\\d+\\s+(?:seats?|slots?|vacanc(?:y|ies)|positions?)\\b',
  '\\b\\d+\\s+(?:seats?|slots?)\\s+(?:left|remaining|only)\\b',
  '\\bseats?\\s+(?:are\\s+)?filling\\s+fast\\b',
  '\\bhurry\\b',
  '\\bapply\\s+(?:immediately|right now|asap)\\b',
  '\\bfirst come,?\\s+first serve[d]?\\b',
  '\\boffer\\s+(?:closes|ends|expires)\\s+(?:tonight|today|soon|in)\\b',
  '\\bregister\\s+(?:in|within)\\s+(?:the\\s+next\\s+)?\\d+\\s+hours?\\b',
  '\\blast\\s+\\d+\\s+(?:seats?|slots?)\\b',
];
const CHAT_CONTACT_SRCS: string[] = [
  '\\b(?:contact|message|messaging|msg|dm|text|reach|ping|apply|send|chat|connect|talk)\\b[^.!?\\n]{0,50}?\\b(?:on|via|through|at|in|to)\\s+(?:our\\s+)?(?:whatsapp|telegram)\\b',
  '\\b(?:whatsapp|telegram)\\s+only\\b',
  '\\bonly\\s+(?:on|via|through)\\s+(?:whatsapp|telegram)\\b',
  '\\bjoin\\s+(?:our\\s+)?(?:official\\s+)?(?:whatsapp|telegram)\\s+(?:channel|group)\\b[^.!?\\n]{0,30}\\bto apply\\b',
];

interface Raw {
  id: ScamSignalId;
  severity: ScamSeverity;
  start: number | null;
  end: number | null;
  quote: string;
  source: ScamSignal['source'];
}

function scan(text: string, srcs: readonly string[], id: ScamSignalId, severity: ScamSeverity, out: Raw[], guard: boolean): void {
  for (const src of srcs) {
    const re = new RegExp(src, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0] === '') {
        re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (guard && negated(text, start, end)) continue;
      out.push({ id, severity, start, end, quote: m[0].slice(0, 160), source: 'text' });
    }
  }
}

/** One signal per id and overlapping span. */
function dedupe(list: Raw[]): Raw[] {
  const sorted = [...list].sort((a, b) => (a.start ?? -1) - (b.start ?? -1) || (b.end ?? 0) - (a.end ?? 0));
  const kept: Raw[] = [];
  for (const r of sorted) {
    const dup = kept.some((k) => k.id === r.id && k.start !== null && r.start !== null && r.start < (k.end ?? 0));
    if (!dup) kept.push(r);
  }
  return kept;
}

function pay(text: string, out: Raw[]): void {
  const fresherCtx = /\bfreshers?\b|\bno (?:prior |previous |work )?experience\b|\bentry[- ]level\b|\b12th pass\b|\bany graduate\b|\bgraduate (?:engineer )?trainee\b|\b20\d\d batch\b|\bbatch of 20\d\d\b/i.test(text);
  if (!fresherCtx) return;
  const lowSkill = /\bno (?:skills?|coding|experience|interview|qualification)\b|\bwork from (?:home|phone)\b|\btyping\b|\bdata entry\b|\b12th pass\b|\bfrom your (?:phone|mobile)\b|\bearn (?:daily|weekly)\b/i.test(text);
  const p = parseSalary(text);
  if (!p || p.currency !== 'INR') return;
  const top = p.maxMinor ?? p.minMinor;
  if (top === null) return;
  const annual = (top / 100) * ANNUAL_FACTOR[p.period];
  if (annual < (lowSkill ? LOW_SKILL_UNREALISTIC_ANNUAL_INR : FRESHER_UNREALISTIC_ANNUAL_INR)) return;
  const ev = p.evidence[0];
  out.push({ id: 'pay.unrealistic', severity: lowSkill ? 'high' : 'medium', start: ev ? ev.start : null, end: ev ? ev.end : null, quote: ev ? ev.quote : '', source: 'text' });
}

export function detectScamSignals(text: string, opts: ScamOptions = {}): ScamResult {
  const t = typeof text === 'string' ? text.slice(0, MAX_TEXT) : '';
  const options = opts ?? {};
  const sender = typeof options.senderEmail === 'string' ? options.senderEmail.trim() : '';
  const optUrl = typeof options.url === 'string' ? options.url.trim() : '';
  const out: Raw[] = [];
  if (t.trim() === '' && sender === '' && optUrl === '') return { signals: [], risk: 'none', flagged: false };

  scan(t, FEE_SRCS, 'fee.upfront', 'high', out, true);
  scan(t, OFFER_SRCS, 'fee.offer_letter', 'high', out, true);
  scan(t, URGENCY_SRCS, 'pressure.urgency', 'low', out, false);
  scan(t, [SHORT_SRC], 'link.shortened', 'medium', out, false);
  if (optUrl && hostIn(hostOf(optUrl), URL_SHORTENER_HOSTS)) out.push({ id: 'link.shortened', severity: 'medium', start: null, end: null, quote: optUrl.slice(0, 160), source: 'url' });

  const urls: string[] = [];
  for (const m of t.matchAll(URL_RE)) urls.push(m[0]);
  if (optUrl) urls.push(optUrl);
  const emails: { addr: string; domain: string; start: number | null; end: number | null }[] = [];
  for (const m of t.matchAll(EMAIL_RE)) emails.push({ addr: m[0], domain: m[1]!.toLowerCase(), start: m.index!, end: m.index! + m[0].length });
  if (sender.includes('@')) emails.push({ addr: sender, domain: sender.slice(sender.lastIndexOf('@') + 1).toLowerCase(), start: null, end: null });

  // Telegram / WhatsApp as the only channel: no email and no non-chat, non-shortener link anywhere.
  const officialUrl = urls.some((u) => {
    const h = hostOf(u);
    return h !== '' && !hostIn(h, URL_SHORTENER_HOSTS) && !hostIn(h, CHAT_HOSTS);
  });
  if (!officialUrl && emails.length === 0) {
    const chat: Raw[] = [];
    scan(t, CHAT_CONTACT_SRCS, 'contact.chat_only', 'medium', chat, false);
    scan(t, [CHAT_LINK_SRC], 'contact.chat_only', 'medium', chat, false);
    for (const r of chat) {
      const start = r.start ?? 0;
      const [s, e] = sentenceBounds(t, start);
      if (/\b(?:is|are)\s+not\s+used\b|\bnever\b|\bdo(?:es)? not\b/i.test(t.slice(s, e))) continue;
      const strong = /\bonly\b|telegram|t\.me/i.test(r.quote);
      out.push({ ...r, severity: strong ? 'high' : 'medium' });
    }
  }

  // A free-mail recruiter is only suspicious when the company evidently has a domain of its own.
  const companyHosts = new Set<string>();
  for (const u of urls) {
    const h = hostOf(u);
    if (h && !hostIn(h, URL_SHORTENER_HOSTS) && !hostIn(h, NON_COMPANY_HOSTS) && !hostIn(h, FREE_MAIL_DOMAINS)) companyHosts.add(h);
  }
  for (const e of emails) if (!hostIn(e.domain, FREE_MAIL_DOMAINS) && !hostIn(e.domain, NON_COMPANY_HOSTS)) companyHosts.add(e.domain);
  for (const m of t.matchAll(BARE_HOST_RE)) {
    const h = m[0].toLowerCase().replace(/^www\./, '');
    if (!hostIn(h, URL_SHORTENER_HOSTS) && !hostIn(h, NON_COMPANY_HOSTS) && !hostIn(h, FREE_MAIL_DOMAINS)) companyHosts.add(h);
  }
  if (companyHosts.size > 0) {
    for (const e of emails) {
      if (!hostIn(e.domain, FREE_MAIL_DOMAINS)) continue;
      const fromOption = e.start === null;
      out.push({ id: 'sender.freemail', severity: 'medium', start: e.start, end: e.end, quote: fromOption ? '***@' + e.domain : e.addr, source: fromOption ? 'senderEmail' : 'text' });
    }
  }

  pay(t, out);

  const signals = dedupe(out);
  const rank = (s: ScamSeverity): number => (s === 'high' ? 3 : s === 'medium' ? 2 : 1);
  let level = signals.reduce((m, s) => Math.max(m, rank(s.severity)), 0);
  const mediums = signals.filter((s) => s.severity === 'medium').length;
  const lows = signals.filter((s) => s.severity === 'low').length;
  if (level === 2 && (mediums >= 2 || lows >= 1)) level = 3;
  const risk: ScamRisk = level === 3 ? 'high' : level === 2 ? 'medium' : level === 1 ? 'low' : 'none';
  return { signals, risk, flagged: level >= 2 };
}
