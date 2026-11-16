import type { MailMessage } from '../mailer.js';

export type CodePurpose = 'login' | 'campus_email';

/** Body for a 6-digit sign-in or college-email proof code. The code stays out of the subject line. */
export function renderCodeEmail(input: { code: string; purpose: CodePurpose; ttlMinutes: number }): Pick<MailMessage, 'subject' | 'text'> {
  if (!/^\d{6}$/.test(input.code)) throw new Error('mail: code must be exactly six digits');
  const subject = input.purpose === 'campus_email' ? 'Confirm your college email for Hirelane' : 'Your Hirelane sign-in code';
  const why =
    input.purpose === 'campus_email'
      ? 'Use this code to confirm your college email address.'
      : 'Use this code to sign in to Hirelane.';
  const text = [
    why,
    '',
    `    ${input.code}`,
    '',
    `It works for ${input.ttlMinutes} minutes and only once.`,
    'If you did not ask for it, ignore this email. No one can use it without access to this inbox.',
    '',
  ].join('\n');
  return { subject, text };
}
