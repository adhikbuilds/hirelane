import { createFileOutbox } from './file-outbox.js';
import type { Mailer } from './mailer.js';

/**
 * The one place a Mailer is chosen. Outside production: the file outbox. In production: only an injected real transport;
 * with none it throws at construction (not at the first send), so email sign-in and the campus join cannot be switched on
 * without a transport.
 */
export function createMailer(opts: { env?: Record<string, string | undefined>; transport?: Mailer; dir?: string; from?: string } = {}): Mailer {
  const env = opts.env ?? process.env;
  if (env['NODE_ENV'] === 'production') {
    if (!opts.transport) throw new Error('mail: no production transport is configured');
    return opts.transport;
  }
  return opts.transport ?? createFileOutbox({ env, ...(opts.dir ? { dir: opts.dir } : {}), ...(opts.from ? { from: opts.from } : {}) });
}
