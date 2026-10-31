import { createFileOutbox, renderCodeEmail } from '@hirelane/agent';
import type { CampusMailDeps } from './membership';

/**
 * The college-email code, delivered like the sign-in code: through the file outbox in dev (the outbox refuses to run when
 * NODE_ENV=production, so a real transport must be chosen before launch). Failures surface as `mail_unavailable`; the
 * address and the code are never logged.
 */
export function fileOutboxCampusMail(): CampusMailDeps {
  const mailer = createFileOutbox();
  return {
    sendCode: async (to, code) => {
      const { subject, text } = renderCodeEmail({ code, purpose: 'campus_email', ttlMinutes: 10 });
      await mailer.send({ to, subject, text });
    },
  };
}
