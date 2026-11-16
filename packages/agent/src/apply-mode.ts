/**
 * Global switches for auto-apply, read from the environment. Pure, no I/O, no network.
 *
 * HIRELANE_AUTO_APPLY = off | fixture | live
 *   off      no application is created or sent (swipe refuses, the worker leaves ready applications alone)
 *   fixture  the executor runs against the fixture transport only (it refuses every real host)
 *   live     reserved for a real transport that does not exist yet; today it behaves as fixture because the guard refuses real hosts
 * Default: off in production, fixture everywhere else. Any unknown value fails closed to off.
 */
export type ApplyMode = 'off' | 'fixture' | 'live';

type Env = Record<string, string | undefined>;

export function applyMode(env: Env = process.env): ApplyMode {
  const raw = env['HIRELANE_AUTO_APPLY'];
  if (raw === undefined || raw === '') return env['NODE_ENV'] === 'production' ? 'off' : 'fixture';
  const v = raw.trim().toLowerCase();
  return v === 'fixture' || v === 'live' || v === 'off' ? v : 'off';
}

const HOST = /^[a-z0-9]([a-z0-9.-]{0,98})[a-z0-9]$/;
const isLocal = (h: string): boolean => h === 'localhost' || h.endsWith('.localhost');

/**
 * The domain of every student's apply address. Addresses are stored permanently and handed to employers, so a production
 * deploy without a real domain must fail at startup instead of minting undeliverable addresses.
 */
export function assertApplyDomain(env: Env = process.env): string {
  const raw = env['HIRELANE_APPLY_DOMAIN']?.trim().toLowerCase();
  if (env['NODE_ENV'] === 'production') {
    if (!raw || !HOST.test(raw)) throw new Error('HIRELANE_APPLY_DOMAIN must be set to a real domain in production');
    if (isLocal(raw)) throw new Error('HIRELANE_APPLY_DOMAIN must not be a localhost name in production');
    return raw;
  }
  return raw || 'apply.hirelane.localhost';
}

/** authserv-id of the receiving MTA whose Authentication-Results inbound mail must carry (see inbound:scan). */
export function authservIdFor(env: Env = process.env): string {
  const raw = env['HIRELANE_MAIL_AUTHSERV_ID']?.trim().toLowerCase();
  if (env['NODE_ENV'] === 'production') {
    if (!raw) throw new Error('HIRELANE_MAIL_AUTHSERV_ID must be set in production');
    if (isLocal(raw)) throw new Error('HIRELANE_MAIL_AUTHSERV_ID must not be a localhost name in production');
    return raw;
  }
  return raw || 'mx.hirelane.localhost';
}
