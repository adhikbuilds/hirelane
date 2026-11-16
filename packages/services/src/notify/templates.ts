import type { MailMessage } from '@hirelane/agent';
import { isCritical, type NotifyKind } from './kinds';

const SUBJECT: Record<NotifyKind, (t: string) => string> = {
  drive_published: (t) => t,
  drive_closing: (t) => t,
  employer_reply: (t) => t,
  outcome_verified: (t) => t,
};

const LEAD: Record<NotifyKind, string> = {
  drive_published: 'Your placement cell has posted a drive you may be able to apply to. Open Hirelane to see the rules we could check for you and the ones we could not.',
  drive_closing: 'A drive for your batch closes tomorrow. Open Hirelane to see the rules and the closing date.',
  employer_reply: 'An employer has replied to one of your applications. Open Hirelane to read it and see what it asks of you.',
  outcome_verified: 'Your placement cell has verified an offer you reported. It now counts in your record.',
};

const oneLine = (s: string): string => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * Plain text only (the mailer takes no HTML). The subject is the notification's own title with control characters removed, so a
 * title can never start a new header. Scam flags never appear: they are for staff.
 */
export function renderNotificationEmail(input: { kind: NotifyKind; title: string; appUrl: string; unsubscribeUrl: string | null }): Pick<MailMessage, 'subject' | 'text'> {
  const title = oneLine(input.title);
  const home = `${input.appUrl.replace(/\/+$/, '')}/home`;
  const lines = [title, '', LEAD[input.kind], '', home, ''];
  if (isCritical(input.kind)) {
    lines.push('We send this one by email because it is about your applications and offers, so it cannot be switched off. It is always on your Home screen too.');
  } else {
    lines.push('This is also on your Home screen, so you lose nothing if you stop these emails.');
    if (input.unsubscribeUrl) lines.push(`Stop these emails: ${input.unsubscribeUrl}`);
  }
  lines.push('');
  return { subject: SUBJECT[input.kind](title) || 'Hirelane', text: lines.join('\n') };
}
