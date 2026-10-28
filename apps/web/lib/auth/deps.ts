import { createFileOutbox, renderCodeEmail } from "@hirelane/agent";
import type { EmailCodeDeps } from "./email-code";
import { defaultAuthDeps } from "./session";

/**
 * Production-shaped wiring: real database, real keys, code mail through the file outbox (.mail/outbox/*.eml).
 * The outbox refuses to run when NODE_ENV=production, so a real transport must be chosen before launch.
 */
export function defaultEmailCodeDeps(): EmailCodeDeps {
  const mailer = createFileOutbox();
  return {
    ...defaultAuthDeps(),
    sendCode: async (to, code, purpose) => {
      const { subject, text } = renderCodeEmail({ code, purpose, ttlMinutes: 10 });
      await mailer.send({ to, subject, text });
    },
  };
}
