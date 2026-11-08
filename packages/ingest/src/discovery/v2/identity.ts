/**
 * Token-collision guard for discovery v2. A board at greenhouse/lever/ashby is only attributed to a seed company when the
 * evidence says it is that company (the "Bolt" / "Stream" problem: two unrelated companies share a slug).
 * verified   : positive evidence the board is this company.
 * mismatch   : the board names a different company and nothing ties it to this one.
 * ambiguous  : no decisive evidence (or a name-only match on a short generic name). Never auto-accepted.
 */

export interface SeedIdentity {
  name: string;
  domain?: string | null;
}
export interface Evidence {
  /** Company names the board itself states (Greenhouse `company_name`). */
  boardNames: string[];
  /** Job and apply URLs seen on the board. */
  jobUrls: string[];
  /** Plain-text description samples. */
  texts: string[];
}
export type IdentityStatus = 'verified' | 'mismatch' | 'ambiguous';
export interface IdentityResult {
  status: IdentityStatus;
  by: ('board_name' | 'domain' | 'name_in_text')[];
}

const SUFFIX = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'india', 'technologies', 'technology', 'tech', 'software', 'solutions', 'systems', 'labs']);

const words = (s: string): string[] => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

function coreWords(name: string): string[] {
  const w = words(name);
  const core = w.filter((x) => !SUFFIX.has(x));
  return core.length ? core : w;
}

/** Long single words and multi-word names are distinctive; "Bolt", "Stream", "Slice" are not. */
export function isDistinctiveName(name: string): boolean {
  const c = coreWords(name);
  return c.length >= 2 || (c[0]?.length ?? 0) >= 8;
}

function hostOf(u: string): string | null {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const domainHost = (d: string): string => d.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0] ?? '';

function domainEvidence(domain: string, ev: Evidence): boolean {
  const d = domainHost(domain);
  if (!d) return false;
  const onDomain = (h: string | null) => h !== null && (h === d || h.endsWith(`.${d}`));
  if (ev.jobUrls.some((u) => onDomain(hostOf(u)))) return true;
  const re = new RegExp(`(?<![a-z0-9.-])(?:[a-z0-9-]+\\.)*${d.replace(/[.]/g, '\\.')}(?![a-z0-9-]|\\.[a-z])`, 'i');
  return ev.texts.some((t) => re.test(t));
}

const sameCompany = (a: string, b: string): boolean => {
  const x = coreWords(a).join(' ');
  const y = coreWords(b).join(' ');
  return x !== '' && x === y;
};

function nameInText(name: string, texts: string[]): boolean {
  const core = coreWords(name).join('\\s+');
  if (!core) return false;
  const re = new RegExp(`(?<![a-z0-9])${core}(?![a-z0-9])`, 'i');
  return texts.filter((t) => re.test(t.normalize('NFKD').replace(/[̀-ͯ]/g, ''))).length >= 2;
}

export function verifyIdentity(seed: SeedIdentity, ev: Evidence): IdentityResult {
  const distinctive = isDistinctiveName(seed.name);
  const by: IdentityResult['by'] = [];
  const nameMatch = ev.boardNames.some((b) => sameCompany(b, seed.name));
  const dom = !!seed.domain && domainEvidence(seed.domain, ev);

  if (nameMatch && distinctive) by.push('board_name');
  if (dom) by.push('domain');
  if (distinctive && nameInText(seed.name, ev.texts)) by.push('name_in_text');
  if (by.length) return { status: 'verified', by };

  if (ev.boardNames.length > 0 && !nameMatch) return { status: 'mismatch', by: [] };
  return { status: 'ambiguous', by: [] };
}
