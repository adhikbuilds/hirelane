import { describe, expect, it } from 'vitest';
import { detectScamSignals } from '../src/scam';

const ids = (text: string, opts?: Parameters<typeof detectScamSignals>[1]) => detectScamSignals(text, opts).signals.map((s) => s.id);

describe('detectScamSignals: shape', () => {
  it('returns no signals for empty, null and non-string input', () => {
    for (const v of ['', '   ', null, undefined, 42 as unknown as string]) {
      const r = detectScamSignals(v as string);
      expect(r.signals).toEqual([]);
      expect(r.risk).toBe('none');
      expect(r.flagged).toBe(false);
    }
  });
  it('offsets slice the exact quote out of the input', () => {
    const text = 'Selected! Pay Rs 1,500 registration fee to confirm your seat.';
    const r = detectScamSignals(text);
    const fee = r.signals.find((s) => s.id === 'fee.upfront')!;
    expect(fee).toBeDefined();
    expect(text.slice(fee.start!, fee.end!)).toBe(fee.quote);
    expect(fee.severity).toBe('high');
    expect(r.flagged).toBe(true);
    expect(r.risk).toBe('high');
  });
  it('is deterministic', () => {
    const t = 'Pay Rs 999 to get the offer letter. Limited seats!';
    expect(JSON.stringify(detectScamSignals(t))).toBe(JSON.stringify(detectScamSignals(t)));
  });
  it('handles 10k+ lines quickly', () => {
    const big = Array.from({ length: 12000 }, (_, i) => `Line ${i} associate engineer fresher 4 LPA apply at https://careers.example.test/${i}`).join('\n');
    const t0 = Date.now();
    expect(detectScamSignals(big).flagged).toBe(false);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it('keeps offsets exact with unicode and emoji', () => {
    const text = '🚀 नमस्ते 👋 Hiring freshers 🎉 Pay Rs 500 registration fee 💰';
    const f = detectScamSignals(text).signals.find((s) => s.id === 'fee.upfront')!;
    expect(f).toBeDefined();
    expect(text.slice(f.start!, f.end!)).toBe(f.quote);
  });
});

describe('fees', () => {
  it.each([
    'Pay Rs 1,500 registration fee to confirm your seat',
    'refundable security deposit of Rs 5000 before joining',
    'Training fee of Rs 8,000 is mandatory',
    'Registration charges of Rs 750 are non-refundable',
    'You need to pay Rs 2,000 for the training kit',
    'Pay the Rs 6,000 joining fee at once',
  ])('flags: %s', (t) => expect(ids(t)).toContain('fee.upfront'));
  it('flags paying for the offer letter', () => {
    expect(ids('To receive your offer letter you need to pay Rs 2,500 processing charges')).toContain('fee.offer_letter');
    expect(ids('Kindly transfer Rs 1,200 for the offer letter')).toContain('fee.offer_letter');
  });
  it.each([
    'No registration fee is charged at any stage of this hiring.',
    'We never ask candidates for any fee or deposit.',
    'Training will be provided free of cost.',
    'Paid training of 3 months with a stipend of Rs 15,000 per month',
    'Registration is free for all students',
    'Our company pays a joining bonus of Rs 30,000 after 90 days',
    'Deposit your resume on the careers portal. Free of cost, no charges.',
    'Offer letter will be shared by email after the HR round.',
  ])('does not flag: %s', (t) => {
    const got = ids(t);
    expect(got).not.toContain('fee.upfront');
    expect(got).not.toContain('fee.offer_letter');
  });
});

describe('chat-only contact', () => {
  it('flags telegram or whatsapp as the only channel', () => {
    expect(ids('HR contact only on Telegram: @hrdesk_demo01')).toContain('contact.chat_only');
    expect(ids('Apply by messaging us on WhatsApp only: 90000 00001')).toContain('contact.chat_only');
    expect(ids('Join our Telegram channel t.me/jobsdemo01 to apply')).toContain('contact.chat_only');
  });
  it('does not flag when an official email or link exists', () => {
    expect(ids('Contact HR on WhatsApp 90000 00005 or write to hr@kestrel.example.test')).not.toContain('contact.chat_only');
    expect(ids('Join our WhatsApp group. Apply at https://apply.example.test/j/1')).not.toContain('contact.chat_only');
  });
  it('does not flag sharing, or a statement that telegram is not used', () => {
    expect(ids('Share this on WhatsApp with your friends')).not.toContain('contact.chat_only');
    expect(ids('Telegram is not used for any communication from our recruiters.')).not.toContain('contact.chat_only');
  });
});

describe('free-mail recruiter', () => {
  it('flags a free-mail sender when the company has its own domain', () => {
    const r = detectScamSignals('Hiring at Zorvane (careers.zorvane.example.test).', { senderEmail: 'hr.desk01@gmail.com', url: 'https://careers.zorvane.example.test/jobs' });
    expect(r.signals.map((s) => s.id)).toContain('sender.freemail');
  });
  it.each(['gmail.com', 'yahoo.com', 'outlook.com', 'rediffmail.com'])('knows %s', (d) => {
    expect(ids('Details at https://co.example.test', { senderEmail: `hr.desk@${d}` })).toContain('sender.freemail');
  });
  it('detects a free-mail address written in the text', () => {
    expect(ids('Site https://co.example.test. Send CV to hr.desk01@yahoo.com')).toContain('sender.freemail');
  });
  it('does not flag when the company shows no domain of its own', () => {
    expect(ids('Send your portfolio to design.demo06@gmail.com')).not.toContain('sender.freemail');
    expect(ids('Apply on https://www.linkedin.com/jobs/view/1 or mail hr.desk@gmail.com')).not.toContain('sender.freemail');
  });
  it('does not flag a corporate sender', () => {
    expect(ids('Hiring', { senderEmail: 'hr@company.example.test', url: 'https://company.example.test' })).not.toContain('sender.freemail');
  });
});

describe('urgency, pay, shorteners', () => {
  it('urgency alone is low severity and not flagged', () => {
    const r = detectScamSignals('Limited seats! Hurry, register early.');
    expect(r.signals.map((s) => s.id)).toContain('pressure.urgency');
    expect(r.signals.every((s) => s.severity === 'low')).toBe(true);
    expect(r.flagged).toBe(false);
  });
  it('plain deadlines are not urgency', () => {
    expect(ids('Last date to apply: 30 November')).not.toContain('pressure.urgency');
  });
  it('urgency plus another signal is flagged', () => {
    expect(detectScamSignals('Only 3 seats left. Apply https://bit.ly/abcDemo').flagged).toBe(true);
  });
  it('flags unrealistic fresher pay', () => {
    expect(ids('Freshers can earn 60 LPA as Software Engineer, no coding required')).toContain('pay.unrealistic');
    expect(ids('Fresher data entry job, earn Rs 4,000 per day, no skills needed')).toContain('pay.unrealistic');
    expect(ids('Work from home, no experience, earn Rs 90,000 per month typing')).toContain('pay.unrealistic');
  });
  it('does not flag realistic fresher pay or experienced pay', () => {
    expect(ids('Fresher Associate Software Engineer, CTC 6.5 LPA')).not.toContain('pay.unrealistic');
    expect(ids('Backend developer, 2 to 4 years experience, 18 LPA')).not.toContain('pay.unrealistic');
    expect(ids('Customer support fresher, Rs 18,000 per month')).not.toContain('pay.unrealistic');
  });
  it.each(['https://bit.ly/3DemoJob1', 'http://tinyurl.com/abc', 'cutt.ly/demo3', 'https://rb.gy/demo44', 'https://t.ly/demo6', 'https://shorturl.at/demo8', 'https://goo.gl/demo9'])('flags shortener %s', (u) => {
    expect(ids(`Apply: ${u}`)).toContain('link.shortened');
  });
  it('checks the url option too, and leaves lnkd.in and real hosts alone', () => {
    expect(ids('Apply now', { url: 'https://bit.ly/x1' })).toContain('link.shortened');
    expect(ids('Apply https://lnkd.in/xkDemo1 or https://careers.example.test/a')).not.toContain('link.shortened');
  });
});

describe('detectScamSignals: pathological input stays linear', () => {
  const cases: Array<[string, string]> = [
    ['digits', '1'.repeat(200_000)],
    ['a. repeats', 'a.'.repeat(100_000)],
    ['10- repeats', '10-'.repeat(66_000)],
    ['url-ish dots', 'http://' + 'a.'.repeat(100_000)],
  ];
  it.each(cases)('finishes 200k chars of %s quickly', (_name, text) => {
    const t0 = performance.now();
    detectScamSignals(text);
    expect(performance.now() - t0).toBeLessThan(100);
  });
  it('still finds a normal email and bare host', () => {
    expect(ids('Site https://co.example.test. Send CV to hr.desk01@yahoo.com')).toContain('sender.freemail');
  });
});
