import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, ownWords, type InboundKind } from '../src/tasks/inbound-classify';
import { decodeEncodedWords, decodeQuotedPrintable, htmlToText, parseAddress, parseEml } from '../src/tasks/inbound-mime';

const DIR = join(import.meta.dirname, 'fixtures/inbound');
const LABELS = JSON.parse(readFileSync(join(DIR, 'labels.json'), 'utf8')) as Record<string, { kind: InboundKind; encoding: string; company: string; domain: string; subject: string }>;
const KINDS: InboundKind[] = ['interview', 'test', 'rejection', 'other'];

describe('the synthetic corpus', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.eml')).sort();
  it('has 60 emails, all labelled, spread over every class and every encoding', () => {
    expect(files).toHaveLength(60);
    expect(Object.keys(LABELS).sort()).toEqual(files);
    for (const k of KINDS) expect(Object.values(LABELS).filter((l) => l.kind === k).length, k).toBeGreaterThanOrEqual(10);
    expect(new Set(Object.values(LABELS).map((l) => l.encoding)).size).toBeGreaterThanOrEqual(9);
  });
  it('is synthetic: only example.test and hirelane.localhost addresses appear, once decoded', () => {
    for (const f of files) {
      const m = parseEml(readFileSync(join(DIR, f)));
      for (const a of [m.fromAddress, ...m.to, ...[...m.text.matchAll(/[\w.+-]+@[\w.-]+/g)].map((x) => x[0])]) expect(a, f).toMatch(/(example\.test|hirelane\.localhost)\.?$/);
    }
  });

  const results = files.map((f) => {
    const mail = parseEml(readFileSync(join(DIR, f)));
    return { f, want: LABELS[f]!.kind, got: classify(mail.subject, mail.text), mail };
  });

  it('parses every email: sender, recipient, subject and a non-empty body', () => {
    for (const r of results) {
      const l = LABELS[r.f]!;
      expect(r.mail.fromAddress, r.f).toBe(`jobs@${l.domain}`);
      expect(r.mail.to.some((a) => /^asha\.k3x(\+[a-z0-9]+)?@apply\.hirelane\.localhost$/.test(a)), r.f).toBe(true);
      expect(r.mail.subject.startsWith(l.subject.slice(0, 20)), `${r.f}: ${r.mail.subject}`).toBe(true);
      expect(r.mail.text.length, r.f).toBeGreaterThan(40);
      expect(r.mail.messageId, r.f).toMatch(/^corpus-\d\d@/);
      expect(r.mail.date, r.f).not.toBeNull();
      expect(r.mail.text, r.f).not.toMatch(/=[0-9A-F]{2}|^[A-Za-z0-9+/]{60,}={0,2}$/m);
    }
  });

  it('status detection reaches at least 0.9 accuracy, and the confusion matrix is on record', () => {
    const matrix: Record<string, Record<string, number>> = {};
    for (const a of KINDS) matrix[a] = Object.fromEntries(KINDS.map((b) => [b, 0]));
    for (const r of results) matrix[r.want]![r.got]!++;
    const correct = results.filter((r) => r.got === r.want).length;
    const accuracy = correct / results.length;
    const wrong = results.filter((r) => r.got !== r.want).map((r) => `${r.f}: want ${r.want} got ${r.got}`);
    console.info(`inbound corpus: accuracy ${(accuracy * 100).toFixed(1)}% (${correct}/${results.length})\nconfusion (rows = labelled, cols = detected)\n${KINDS.join(' ')}\n${KINDS.map((k) => `${k.padEnd(10)} ${KINDS.map((j) => matrix[k]![j]).join(' ')}`).join('\n')}\n${wrong.join('\n')}`);
    expect(wrong).toEqual([]);
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
    for (const k of KINDS) {
      const recall = matrix[k]![k]! / Object.values(LABELS).filter((l) => l.kind === k).length;
      expect(recall, `recall of ${k}`).toBeGreaterThanOrEqual(0.8);
    }
  });
});

describe('hard negatives, one by one', () => {
  it('a rejection that quotes an earlier interview invite is a rejection', () => {
    const text = 'Hi Asha,\n\nWe have decided not to proceed with your candidature.\n\nOn Mon, 27 Oct 2026 at 10:15, Recruiting <jobs@x.example.test> wrote:\n> We would like to invite you for an interview on Tuesday.\n> Please confirm your availability.';
    expect(classify('Re: Interview invitation', text)).toBe('rejection');
    expect(ownWords(text)).not.toMatch(/invite you/);
  });
  it('the same quoted invite without a rejection above it is still read as the sender\'s words only', () => {
    expect(classify('Re: Interview invitation', 'Thanks for your note, noted.\n\n> We would like to invite you for an interview on Tuesday.')).toBe('other');
  });
  it('"unfortunately" in a signature or an out-of-office is not a rejection', () => {
    expect(classify('Your interview', 'Hi, we would like to schedule a call with you on Tuesday.\n\n-- \nSam\nUnfortunately our office is closed on public holidays.')).toBe('interview');
    expect(classify('Automatic reply: out of office', 'Unfortunately I will not be able to respond until Monday.')).toBe('other');
  });
  it('an acknowledgement that mentions interviews and tests conditionally is other', () => {
    expect(classify('We received your application', 'Thanks for applying. If we would like to interview you, we will contact you. Should we decide to schedule an assessment you will hear from us.')).toBe('other');
  });
  it('a test invitation that promises interviews later is a test', () => {
    expect(classify('Next step', 'Please complete the online assessment below. After you clear this stage we will invite you to an interview.')).toBe('test');
  });
  it('a rejection after an assessment or an interview stays a rejection', () => {
    expect(classify('Assessment results', 'Thanks for completing our assessment. Unfortunately your score did not meet the threshold.')).toBe('rejection');
    expect(classify('Thank you for interviewing', 'We enjoyed the interview but have decided to pursue other candidates.')).toBe('rejection');
  });
  it('attachment text is never read', () => {
    const raw = ['From: A <a@x.example.test>', 'Subject: Hello', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', '', '--b', 'Content-Type: text/plain', '', 'Welcome to our newsletter.', '--b', 'Content-Type: text/plain; name=n.txt', 'Content-Disposition: attachment; filename=n.txt', '', 'interview rejected unfortunately', '--b--', ''].join('\n');
    const m = parseEml(raw);
    expect(m.text).toBe('Welcome to our newsletter.');
    expect(classify(m.subject, m.text)).toBe('other');
  });
  it('empty and garbage input is other, never a throw', () => {
    expect(classify('', '')).toBe('other');
    expect(parseEml('').text).toBe('');
    expect(() => parseEml(Buffer.from([0xff, 0xfe, 0x00, 0x41]))).not.toThrow();
    expect(parseEml('Content-Type: multipart/mixed; boundary=\n\n--x').text).toBe('');
  });
});

describe('MIME pieces', () => {
  it('decodes RFC 2047 words, B and Q, adjacent words and charsets', () => {
    expect(decodeEncodedWords(`=?UTF-8?B?${Buffer.from('Hello ₹').toString('base64')}?=`)).toBe('Hello ₹');
    expect(decodeEncodedWords('=?ISO-8859-1?Q?Caf=E9_menu?=')).toBe('Café menu');
    expect(decodeEncodedWords('=?UTF-8?B?SGVs?= =?UTF-8?B?bG8=?=')).toBe('Hello');
    expect(decodeEncodedWords('plain subject')).toBe('plain subject');
  });
  it('decodes quoted-printable with soft line breaks', () => {
    expect(decodeQuotedPrintable('caf=C3=A9 and =\nmore').toString('utf8')).toBe('café and more');
    expect(decodeQuotedPrintable('100% =ZZ stays').toString('utf8')).toBe('100% =ZZ stays');
  });
  it('reads addresses with and without a display name', () => {
    expect(parseAddress('"Acme, Inc. Recruiting" <Jobs@Acme.example.test>')).toEqual({ name: 'Acme, Inc. Recruiting', address: 'jobs@acme.example.test' });
    expect(parseAddress('jobs@acme.example.test')).toEqual({ name: '', address: 'jobs@acme.example.test' });
    expect(parseAddress('=?UTF-8?B?QWNtZQ==?= <a@b.example.test>').name).toBe('Acme');
    expect(parseAddress('nonsense')).toEqual({ name: '', address: '' });
  });
  it('turns HTML into text without scripts, styles or tags', () => {
    expect(htmlToText('<html><head><style>p{}</style></head><body><p>Hi&nbsp;there &amp; welcome</p><script>alert(1)</script><p>Bye</p></body></html>')).toBe('Hi there & welcome\nBye');
  });
  it('unfolds headers and ignores a huge body', () => {
    const m = parseEml('From: a@b.example.test\nSubject: one\n two\n\tthree\n\nbody');
    expect(m.subject).toBe('one two three');
    expect(parseEml(`Subject: x\n\n${'a'.repeat(3_000_000)}`).text.length).toBeLessThanOrEqual(1_000_000);
  });
});
