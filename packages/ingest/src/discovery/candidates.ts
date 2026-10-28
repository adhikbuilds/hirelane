/** Company name (and optional domain) to candidate ATS board tokens. Pure; the probe decides which are real. */

const SUFFIXES = new Set([
  'pvt', 'private', 'ltd', 'limited', 'llp', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'technologies', 'technology', 'tech', 'labs', 'lab', 'india', 'software', 'solutions', 'systems',
]);

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function words(s: string): string[] {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function domainStem(domain: string): string | null {
  let h = domain.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0] ?? '';
  h = h.replace(/:\d+$/, '').replace(/^www\./, '');
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  // second-level label; handles co.in / com.au style public suffixes
  const sld = parts.length >= 3 && ['co', 'com', 'org', 'net'].includes(parts[parts.length - 2]!) ? parts[parts.length - 3]! : parts[parts.length - 2]!;
  return sld.replace(/[^a-z0-9-]/g, '') || null;
}

export function candidateTokens(name: string, domain?: string | null): string[] {
  const out: string[] = [];
  const add = (t: string | null | undefined) => {
    if (t && t.length >= 2 && SLUG.test(t) && !out.includes(t)) out.push(t);
  };

  const full = typeof name === 'string' ? words(name) : [];
  let core = full.filter((w) => !SUFFIXES.has(w));
  if (core.length === 0) core = full;

  if (core.length) {
    add(core.join(''));
    add(core.join('-'));
  }
  if (full.length && full.length !== core.length) {
    add(full.join(''));
    add(full.join('-'));
  }
  if (domain) add(domainStem(domain));
  return out;
}
