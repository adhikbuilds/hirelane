/**
 * Company logo discovery and normalisation. Own-domain favicon / touch icons only, SVG never accepted,
 * every candidate fetched through guardedGet, decoded under a pixel cap, re-encoded to a 64x64 PNG
 * (which also drops all metadata). No usable icon gives ok:false and the caller falls back to a monogram.
 */
import sharp, { type Sharp } from 'sharp';
import { extractIcoImage } from './ico';
import { guardedGet, isOwnHost, LogoRejected, type GuardDeps, type RejectReason } from './logo-fetch';
import { canonicalDomain } from './name';

export const LOGO_SIZE = 64;
export const MAX_LOGO_BYTES = 200 * 1024;
export const MIN_SOURCE_SIDE = 32;
export const MAX_SOURCE_PIXELS = 1024 * 1024;
export const MAX_CANDIDATES = 8;
export const IMAGE_TYPES = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'] as const;
const HTML_TYPES = ['text/html', 'application/xhtml+xml'] as const;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO_SIG = Buffer.from([0, 0, 1, 0]);

export interface Attempt {
  url: string;
  reason: RejectReason | 'ok';
}
export type LogoResult =
  | { ok: true; png: Buffer; sourceUrl: string; attempts: Attempt[] }
  | { ok: false; reason: 'no_domain' | 'no_usable_icon'; attempts: Attempt[] };

/** `<link rel=icon|apple-touch-icon>` URLs from page HTML, best first: touch icons, then by declared size. */
export function discoverIcons(html: string, baseUrl: string): string[] {
  const found: { url: string; apple: boolean; size: number; order: number }[] = [];
  let order = 0;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([a-z][a-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
      attrs[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
    }
    const rel = (attrs['rel'] ?? '').toLowerCase().split(/\s+/);
    const apple = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!apple && !rel.includes('icon')) continue;
    if (!attrs['href'] || /svg/i.test(attrs['type'] ?? '')) continue;
    let u: URL;
    try {
      u = new URL(attrs['href'], baseUrl);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    if (/\.svgz?$/i.test(u.pathname)) continue;
    const sz = /(\d+)x(\d+)/i.exec(attrs['sizes'] ?? '');
    found.push({ url: u.toString(), apple, size: sz ? Math.min(Number(sz[1]), Number(sz[2])) : 0, order: order++ });
  }
  found.sort((a, b) => Number(b.apple) - Number(a.apple) || b.size - a.size || a.order - b.order);
  return [...new Set(found.map((f) => f.url))];
}

async function toLogoPng(bytes: Buffer): Promise<Buffer> {
  let input: Sharp;
  let w: number | undefined;
  let h: number | undefined;
  if (bytes.subarray(0, 8).equals(PNG_SIG)) {
    input = sharp(bytes, { limitInputPixels: MAX_SOURCE_PIXELS, failOn: 'error', sequentialRead: true });
    try {
      const m = await input.metadata();
      w = m.width;
      h = m.height;
    } catch (e) {
      // sharp enforces limitInputPixels while reading the header: "Input image exceeds pixel limit".
      throw new LogoRejected(/pixel limit/i.test(String(e)) ? 'too_many_pixels' : 'bad_image');
    }
  } else if (bytes.subarray(0, 4).equals(ICO_SIG)) {
    const img = extractIcoImage(bytes);
    if (!img) throw new LogoRejected('bad_image', 'ico');
    if (img.kind === 'png') return toLogoPng(img.data);
    w = img.width;
    h = img.height;
    input = sharp(img.data, { raw: { width: w, height: h, channels: 4 }, limitInputPixels: MAX_SOURCE_PIXELS });
  } else {
    throw new LogoRejected('magic_mismatch');
  }
  if (!w || !h) throw new LogoRejected('bad_image');
  if (w * h > MAX_SOURCE_PIXELS) throw new LogoRejected('too_many_pixels');
  if (Math.min(w, h) < MIN_SOURCE_SIDE) throw new LogoRejected('too_small');
  try {
    return await input
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  } catch (e) {
    throw new LogoRejected(/pixel limit/i.test(String(e)) ? 'too_many_pixels' : 'bad_image', 'decode');
  }
}

export async function fetchCompanyLogo(rawDomain: string | null | undefined, deps: GuardDeps): Promise<LogoResult> {
  const domain = canonicalDomain(rawDomain);
  const attempts: Attempt[] = [];
  if (!domain) return { ok: false, reason: 'no_domain', attempts };

  const home = `https://${domain}/`;
  let candidates: string[] = [];
  try {
    const page = await guardedGet(home, { domain, maxBytes: MAX_LOGO_BYTES, allowedTypes: HTML_TYPES, truncate: true }, deps);
    candidates = discoverIcons(page.body.toString('utf8'), page.finalUrl);
  } catch (e) {
    attempts.push({ url: home, reason: e instanceof LogoRejected ? e.reason : 'network' });
  }
  const ownHost = (u: string) => {
    try {
      return isOwnHost(new URL(u).hostname.toLowerCase(), domain);
    } catch {
      return false;
    }
  };
  const list = [...new Set([...candidates.filter(ownHost), `${home}apple-touch-icon.png`, `${home}favicon.ico`])].slice(0, MAX_CANDIDATES);

  for (const url of list) {
    try {
      const got = await guardedGet(url, { domain, maxBytes: MAX_LOGO_BYTES, allowedTypes: IMAGE_TYPES }, deps);
      const png = await toLogoPng(got.body);
      attempts.push({ url, reason: 'ok' });
      return { ok: true, png, sourceUrl: got.finalUrl, attempts };
    } catch (e) {
      attempts.push({ url, reason: e instanceof LogoRejected ? e.reason : 'bad_image' });
    }
  }
  return { ok: false, reason: 'no_usable_icon', attempts };
}
