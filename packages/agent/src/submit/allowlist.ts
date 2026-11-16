/**
 * The apply-host allowlist. The executor checks it before it asks the transport for anything, so a URL that is not on the list
 * never reaches a network, whatever the transport is. It is a second door in front of the transport's own guard (transport.ts).
 *
 * Patterns: an exact host ("boards.example.com") or a wildcard suffix ("*.example.com", which never matches the bare domain).
 * Only https, no credentials in the URL, no IP literals, no port.
 */
export const DEFAULT_ALLOWED_HOSTS: readonly string[] = ['*.fixture.invalid'];

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function applyHostAllowed(url: string, allowed: readonly string[] = DEFAULT_ALLOWED_HOSTS): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.includes(':') || IPV4.test(host)) return false;
  return allowed.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (p.startsWith('*.')) {
      const suffix = p.slice(1); // ".example.com"
      return host.length > suffix.length && host.endsWith(suffix);
    }
    return host === p;
  });
}
