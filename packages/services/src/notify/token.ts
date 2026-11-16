import { createHash } from 'node:crypto';
import type { KeyProvider } from '@hirelane/vault';
import { hmac } from '@hirelane/vault';

export const UNSUB_PURPOSE = 'notify/unsub';

/**
 * The student's unsubscribe token: a keyed hash of their id, so every mail to them carries the same token and nobody can
 * make one for another student without the key. The database holds only its sha256 (notification_unsub.token_hash).
 */
export const unsubscribeToken = (keys: KeyProvider, userId: string): Promise<string> => hmac(keys, UNSUB_PURPOSE, userId);

export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** `<app origin>/unsubscribe?t=<token>`. Refuses anything but an http(s) origin. */
export function unsubscribeUrl(appUrl: string, token: string): string {
  const u = new URL(appUrl);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('notify: appUrl must be http(s)');
  return `${u.origin}/unsubscribe?t=${encodeURIComponent(token)}`;
}
