/** Public-address check for the logo SSRF guard. Anything unparseable or special-purpose is "not public". */
import { isIPv4, isIPv6 } from 'node:net';

function v4Octets(ip: string): number[] | null {
  if (!isIPv4(ip)) return null; // node rejects leading zeros / short forms
  return ip.split('.').map(Number);
}

function v4Public(o: number[]): boolean {
  const [a, b, c] = o as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** Expands an IPv6 literal into 8 16-bit groups, or null. */
function v6Groups(ip: string): number[] | null {
  if (!isIPv6(ip)) return null;
  let s = ip.split('%')[0]!;
  const dot = s.lastIndexOf('.');
  if (dot !== -1) {
    const colon = s.lastIndexOf(':');
    const o = v4Octets(s.slice(colon + 1));
    if (!o) return null;
    s = `${s.slice(0, colon + 1)}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = s.includes('::') ? 8 - h.length - t.length : 0;
  if (fill < 0) return null;
  const all = [...h, ...Array<string>(fill).fill('0'), ...t].map((x) => parseInt(x, 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n)) ? all : null;
}

export function isPublicIp(ip: string): boolean {
  if (typeof ip !== 'string') return false;
  const o = v4Octets(ip);
  if (o) return v4Public(o);
  const g = v6Groups(ip);
  if (!g) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g.every((x) => x === 0)) return false; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return false; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d): judge the embedded v4.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return v4Public([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]);
  }
  if (g0 === 0x64 && g1 === 0xff9b) return false; // NAT64 embeds arbitrary v4
  if ((g0 & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return false; // deprecated site-local
  if ((g0 & 0xff00) === 0xff00) return false; // multicast
  if (g0 === 0x2002) return false; // 6to4 embeds v4
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return false; // Teredo, documentation
  return true;
}
