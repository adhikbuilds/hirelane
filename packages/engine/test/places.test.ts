import { describe, expect, it } from 'vitest';
import data from '../data/places.json';
import { EngineInvariantError } from '../src/errors';
import { defaultPlaceIndex, isKnownPlace, normPlace, REGION_MEMBERS, resolveCountries } from '../src/places';
import { isTrace } from '../src/trace';

const c = (locs: string[], wp?: 'remote' | 'hybrid' | 'onsite' | null) => resolveCountries(locs, undefined, wp);

describe('data/places.json', () => {
  const d = data as unknown as {
    countries: { code: string; name: string; aliases: string[] }[];
    subdivisions: { country: string; code: string }[];
    cities: { name: string; country: string; sub?: string }[];
    regions: Record<string, { members: string[] }>;
  };
  const codes = new Set(d.countries.map((x) => x.code));
  it('has countries, US states, major cities and regions', () => {
    expect(d.countries.length).toBeGreaterThanOrEqual(150);
    expect(d.subdivisions.filter((s) => s.country === 'US').length).toBe(51);
    expect(d.cities.length).toBeGreaterThanOrEqual(500);
    expect(Object.keys(d.regions).sort()).toEqual(['AMERICAS', 'APAC', 'EEA', 'EMEA', 'EU', 'EUROPE', 'LATAM', 'NORTH_AMERICA']);
  });
  it('only refers to known country codes', () => {
    for (const s of d.subdivisions) expect(codes.has(s.country), s.code).toBe(true);
    for (const x of d.cities) expect(codes.has(x.country), x.name).toBe(true);
    for (const r of Object.values(d.regions)) for (const m of r.members) expect(codes.has(m), m).toBe(true);
  });
  it('includes the required aliases', () => {
    const all = d.cities.flatMap((x) => [x.name, ...((x as { aliases?: string[] }).aliases ?? [])]).map((s) => s.toLowerCase());
    for (const a of ['bengaluru', 'bangalore', 'gurugram', 'gurgaon']) expect(all).toContain(a);
  });
  it('keeps region membership consistent', () => {
    expect(REGION_MEMBERS.EU).toHaveLength(27);
    for (const m of REGION_MEMBERS.EU) expect(REGION_MEMBERS.EEA).toContain(m);
    for (const m of REGION_MEMBERS.EEA) expect(REGION_MEMBERS.EUROPE).toContain(m);
    expect(REGION_MEMBERS.EMEA).toContain('AE');
    expect(REGION_MEMBERS.NORTH_AMERICA).toEqual(['CA', 'MX', 'US']);
    expect(Object.isFrozen(REGION_MEMBERS.EU)).toBe(true);
  });
});

describe('normPlace', () => {
  it('folds case, accents, dots and apostrophes', () => {
    expect(normPlace('  São Paulo ')).toBe('sao paulo');
    expect(normPlace('Washington, D.C.')).toBe('washington dc');
    expect(normPlace("St. John's")).toBe('st johns');
    expect(normPlace('Zürich')).toBe('zurich');
  });
});

describe('contract examples (task 2.6)', () => {
  it('Temporal: three segments, bare $ context', () => {
    const r = c(['United States (Remote) · Canada (Remote) · Canada']);
    expect(r.countries).toEqual(['CA', 'US']);
    expect(r.remoteScope).toBe('countries');
    expect(r.perLocation).toHaveLength(3);
    expect(r.perLocation.map((p) => p.remote)).toEqual([true, true, false]);
    expect(r.perLocation.map((p) => p.index)).toEqual([0, 0, 0]);
  });
  it('right-to-left comma parts', () => {
    expect(c(['Austin, Texas, United States']).countries).toEqual(['US']);
    expect(c(['London, England, United Kingdom']).countries).toEqual(['GB']);
    expect(c(['Boston, MA']).countries).toEqual(['US']);
  });
  it('lowercase bengaluru gives IN (Lever fixture)', () => {
    expect(c(['bengaluru']).countries).toEqual(['IN']);
    expect(c(['Bangalore, Karnataka']).countries).toEqual(['IN']);
    expect(c(['Gurgaon']).countries).toEqual(['IN']);
    expect(c(['Gurugram']).countries).toEqual(['IN']);
  });
  it('airtable greenhouse locations', () => {
    expect(c(['Remote - US']).countries).toEqual(['US']);
    expect(c(['Remote - US']).remoteScope).toBe('countries');
    expect(c(['Austin, Texas, United States']).remoteScope).toBe('none');
    expect(c(['London, England, United Kingdom', 'Austin, Texas, United States']).countries).toEqual(['GB', 'US']);
  });
  it('ambiguous cities go to the largest unless qualified', () => {
    expect(c(['London']).countries).toEqual(['GB']);
    expect(c(['London, ON']).countries).toEqual(['CA']);
    expect(c(['Paris']).countries).toEqual(['FR']);
    expect(c(['Paris, Texas, United States']).countries).toEqual(['US']);
    expect(c(['Dublin']).countries).toEqual(['IE']);
    expect(c(['Dublin, CA']).countries).toEqual(['US']);
    expect(c(['Vancouver']).countries).toEqual(['CA']);
    expect(c(['Vancouver, WA']).countries).toEqual(['US']);
    expect(c(['Hyderabad']).countries).toEqual(['IN']);
  });
  it('two-letter codes are countries only in remote patterns', () => {
    expect(c(['Remote - CA']).countries).toEqual(['CA']);
    expect(c(['CA (Remote)']).countries).toEqual(['CA']);
    expect(c(['Remote - UK']).countries).toEqual(['GB']);
    expect(c(['Remote - IN']).countries).toEqual(['IN']);
    expect(c(['San Jose, CA']).countries).toEqual(['US']);
    expect(c(['Indianapolis, IN']).countries).toEqual(['US']);
    expect(c(['Berlin, DE']).countries).toEqual(['DE']);
    expect(c(['Wilmington, DE']).countries).toEqual(['US']);
    expect(c(['Remote - CA']).perLocation[0]!.ruleId).toBe('place.remote_cc');
  });
  it('worldwide remote', () => {
    for (const s of ['Remote', 'Anywhere', 'Worldwide', 'Global', 'Distributed', 'Remote - Worldwide']) {
      const r = c([s]);
      expect(r.remoteScope, s).toBe('worldwide');
      expect(r.countries, s).toEqual([]);
      expect(r.perLocation[0]!.ruleId, s).toBe('place.worldwide');
    }
  });
  it('region-scoped remote expands to the members', () => {
    const r = c(['Remote - EMEA']);
    expect(r.remoteScope).toBe('region');
    expect(r.regions).toEqual(['EMEA']);
    expect(r.countries).toEqual([...REGION_MEMBERS.EMEA].sort());
    expect(c(['Remote, Europe']).regions).toEqual(['EUROPE']);
    expect(c(['Remote - North America']).countries).toEqual(['CA', 'MX', 'US']);
    expect(c(['Remote - EU']).countries).toHaveLength(27);
    expect(c(['Remote, AMER']).regions).toEqual(['AMERICAS']);
    expect(c(['Remote - APAC']).regions).toEqual(['APAC']);
    expect(c(['Latin America']).regions).toEqual(['LATAM']);
  });
});

describe('fixture formats', () => {
  it('splits on separators but not inside parentheses', () => {
    expect(c(['San Francisco, CA | New York City, NY | Seattle, WA']).perLocation).toHaveLength(3);
    expect(c(['San Francisco, CA • New York, NY • United States']).countries).toEqual(['US']);
    expect(c([' Southaven, MS; Memphis, TN']).countries).toEqual(['US']);
    expect(c(['Remote, Canada; Remote, United States']).countries).toEqual(['CA', 'US']);
    expect(c(['Canada - Remote (ON, AB, BC, or NS Only)']).countries).toEqual(['CA']);
    expect(c(['London or Remote']).perLocation.length).toBe(2);
    expect(c(['San Francisco / New York']).countries).toEqual(['US']);
  });
  it('handles country-first and state-first dash forms', () => {
    expect(c(['Massachusetts - Boston']).countries).toEqual(['US']);
    expect(c(['Spain - Barcelona']).countries).toEqual(['ES']);
    expect(c(['United Kingdom - London']).countries).toEqual(['GB']);
    expect(c(['New York - New York City']).countries).toEqual(['US']);
    expect(c(['North Carolina - Raleigh']).countries).toEqual(['US']);
    expect(c(['India - Hyderabad']).countries).toEqual(['IN']);
    expect(c(['China - Shanghai']).countries).toEqual(['CN']);
  });
  it('handles missing commas, annotations and D.C.', () => {
    expect(c(['San Mateo, CA United States']).countries).toEqual(['US']);
    expect(c(['Cary,North Carolina,United States']).countries).toEqual(['US']);
    expect(c(['New York, NY (HQ)']).countries).toEqual(['US']);
    expect(c(['Washington, D.C.']).countries).toEqual(['US']);
    expect(c(['Washington, DC']).countries).toEqual(['US']);
    expect(c(['Mountain View, CA, USA']).countries).toEqual(['US']);
  });
  it('handles Remote variants', () => {
    for (const s of ['Remote US', 'Remote U.S.', 'US - Remote', 'Remote (US)', 'Remote, United States', 'United States - Remote', 'Remote - USA', 'Remote- US']) {
      const r = c([s]);
      expect(r.countries, s).toEqual(['US']);
      expect(r.remoteScope, s).toBe('countries');
    }
  });
  it('splits comma lists of standalone cities into separate locations', () => {
    const r = c(['London, Berlin, Toronto']);
    expect(r.countries).toEqual(['CA', 'DE', 'GB']);
    expect(r.perLocation).toHaveLength(3);
  });
  it('reads several countries in one remote unit', () => {
    expect(c(['Remote - US, Canada, UK']).countries).toEqual(['CA', 'GB', 'US']);
    expect(c(['Remote (Continental US + Hawaii + Canada only)']).countries).toEqual(['CA', 'US']);
  });
  it('resolves cc-prefixed office codes', () => {
    expect(c(['US-NYC']).countries).toEqual(['US']);
    expect(c(['US-SF-HQ, US-SEA, US-CHI']).countries).toEqual(['US']);
  });
  it('folds accents and case', () => {
    expect(c(['São Paulo']).countries).toEqual(['BR']);
    expect(c(['MUNICH, GERMANY']).countries).toEqual(['DE']);
    expect(c(['Zurich, CH']).countries).toEqual(['CH']);
  });
  it('resolves state-only locations', () => {
    expect(c(['California, United States']).countries).toEqual(['US']);
    expect(c(['Texas']).countries).toEqual(['US']);
    expect(c(['Noida, Uttar Pradesh']).countries).toEqual(['IN']);
    expect(c(['Foster City, CA']).countries).toEqual(['US']);
  });
});

describe('unresolved and remote workplace', () => {
  it('reports unresolved segments and non-place words', () => {
    const r = c(['Hybrid', 'Nowhereville']);
    expect(r.countries).toEqual([]);
    expect(r.unresolved).toEqual(['Hybrid', 'Nowhereville']);
    expect(r.trace.outcome).toBe('unknown');
    expect(r.remoteScope).toBe('none');
  });
  it('returns null outcome for no locations', () => {
    const r = c([]);
    expect(r.trace.outcome).toBe('null');
    expect(r.countries).toEqual([]);
  });
  it('uses the remote workplace when no segment says remote', () => {
    expect(c(['San Francisco'], 'remote').remoteScope).toBe('countries');
    expect(c(['Hybrid'], 'remote').remoteScope).toBe('worldwide');
    expect(c([], 'remote').remoteScope).toBe('worldwide');
    expect(c(['San Francisco'], 'hybrid').remoteScope).toBe('none');
    expect(c(['San Francisco'], null).remoteScope).toBe('none');
  });
  it('keeps countries of other locations next to a worldwide segment', () => {
    const r = c(['Remote', 'London']);
    expect(r.remoteScope).toBe('worldwide');
    expect(r.countries).toEqual(['GB']);
  });
  it('rejects a foreign index', () => {
    expect(() => resolveCountries(['x'], { version: 'x' })).toThrow(EngineInvariantError);
  });
});

describe('trace and determinism', () => {
  it('emits a valid, JSON-safe trace with location evidence', () => {
    const raw = 'Austin, Texas, United States';
    const r = resolveCountries([raw]);
    expect(isTrace(r.trace)).toBe(true);
    const ev = r.trace.steps.flatMap((s) => s.evidence);
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) {
      expect(e.source).toBe('location');
      expect(e.index).toBe(0);
      expect(raw.slice(e.start, e.end)).toBe(e.quote);
    }
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r.trace.subject).toBe('countries');
  });
  it('is deterministic', () => {
    const l = ['Remote - EMEA', 'London', 'Remote, Canada; Remote, United States'];
    expect(JSON.stringify(resolveCountries(l))).toBe(JSON.stringify(resolveCountries(l)));
  });
  it('sorts countries and regions', () => {
    const r = c(['Tokyo', 'Berlin', 'Austin, TX']);
    expect(r.countries).toEqual(['DE', 'JP', 'US']);
  });
});

describe('isKnownPlace', () => {
  const idx = defaultPlaceIndex();
  it('recognises gazetteer places and rejects other text', () => {
    expect(isKnownPlace(idx, 'London')).toBe(true);
    expect(isKnownPlace(idx, 'Bengaluru')).toBe(true);
    expect(isKnownPlace(idx, 'US')).toBe(true);
    expect(isKnownPlace(idx, 'Europe')).toBe(true);
    expect(isKnownPlace(idx, 'Boston, MA')).toBe(true);
    expect(isKnownPlace(idx, 'Platform')).toBe(false);
    expect(isKnownPlace(idx, 'Developer Experience')).toBe(false);
    expect(isKnownPlace(idx, '')).toBe(false);
  });
  it('exposes a stable version', () => {
    expect(idx.version).toMatch(/^pl-/);
    expect(defaultPlaceIndex()).toBe(idx);
  });
});
