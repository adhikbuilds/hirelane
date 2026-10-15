/** Deterministic placeholder for companies without a usable logo. Data, not pixels: the UI draws it, so no font dependence. */

export interface Monogram {
  initials: string;
  hue: number;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function monogram(name: string, slug: string): Monogram {
  const words = (typeof name === 'string' ? name : '').match(/[\p{L}\p{N}]+/gu) ?? [];
  const first = (w: string) => [...w][0]!.toLocaleUpperCase();
  let initials = '?';
  if (words.length >= 2) initials = first(words[0]!) + first(words[1]!);
  else if (words.length === 1) {
    const w = [...words[0]!];
    const allCaps = w.length >= 2 && w.length <= 4 && words[0] === words[0]!.toLocaleUpperCase() && /\p{L}/u.test(words[0]!);
    initials = allCaps ? w[0]! + w[1]! : first(words[0]!);
  }
  return { initials, hue: fnv1a(slug) % 360 };
}
