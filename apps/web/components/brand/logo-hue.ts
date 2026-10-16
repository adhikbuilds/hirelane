/** Stable 32-bit FNV-1a hash of a company name, folded to a hue in degrees [0, 360). Same name, same hue, always. */
export function hueFor(name: string): number {
  let h = 0x811c9dc5;
  for (const ch of name.normalize("NFKC").trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

/** Up to two upper-case letters: initials of the first two words, or the first two letters of a single word. */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? [...words[0]!][0]! + [...words[1]!][0]! : [...words[0]!].slice(0, 2).join("");
  return letters.toLocaleUpperCase("en-US");
}

/** Only same-origin absolute paths; never a URL an employer could point at a tracker. */
export function safeLogo(path: string | null | undefined): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("..") || path.includes("\\")) return null;
  return path;
}
