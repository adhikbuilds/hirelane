/**
 * Task 2.6: gazetteer and country resolution. Rule-only, no Intl, no I/O.
 * Data: data/places.json (countries, US/CA/AU/IN subdivisions, major cities, regions).
 */
import placesData from '../data/places.json';
import type { Workplace } from './classify/workplace';
import { EngineInvariantError } from './errors';
import { evidence } from './internal/tracer';
import { TraceBuilder } from './trace';
import type { Trace } from './trace';
import type { CountryCode } from './types';

export type Region = 'EMEA' | 'EU' | 'EEA' | 'EUROPE' | 'APAC' | 'LATAM' | 'AMERICAS' | 'NORTH_AMERICA';

export interface PlaceIndex {
  readonly version: string;
}

interface RawPlaces {
  version: number;
  countries: { code: string; name: string; aliases: string[] }[];
  subdivisions: { country: string; code: string; name: string; aliases: string[] }[];
  cities: { name: string; aliases?: string[]; country: string; sub?: string; pop: number }[];
  regions: Record<string, { aliases: string[]; members: string[] }>;
}
const DATA = placesData as unknown as RawPlaces;

export const REGION_MEMBERS: Readonly<Record<Region, readonly CountryCode[]>> = Object.freeze(
  Object.fromEntries(Object.entries(DATA.regions).map(([k, v]) => [k, Object.freeze([...v.members])])) as Record<
    Region,
    readonly CountryCode[]
  >,
);

export interface LocationResolution {
  index: number;
  part: string;
  country: CountryCode | null;
  region: Region | null;
  remote: boolean;
  ruleId: string;
}

export interface CountryResolution {
  countries: CountryCode[];
  remoteScope: 'none' | 'countries' | 'region' | 'worldwide';
  regions: Region[];
  perLocation: LocationResolution[];
  unresolved: string[];
  trace: Trace;
}

interface SubEntry {
  country: string;
  code: string;
  name: string;
}
interface CityEntry {
  name: string;
  country: string;
  sub: string | null;
  pop: number;
}

/** Subdivision abbreviations are only trusted for these countries. */
const ABBR_COUNTRIES = new Set(['US', 'CA', 'AU']);
const ABBR_PRIORITY = ['US', 'CA', 'AU'];

class CompiledPlaceIndex implements PlaceIndex {
  readonly version = `pl-${DATA.version}-${DATA.countries.length}-${DATA.subdivisions.length}-${DATA.cities.length}`;
  readonly countryByName = new Map<string, string>();
  readonly isoCodes = new Set<string>();
  readonly subByName = new Map<string, SubEntry[]>();
  readonly subByCode = new Map<string, SubEntry[]>();
  readonly cityByName = new Map<string, CityEntry[]>();
  readonly regionByName = new Map<string, Region>();
  maxTokens = 1;
}

/** Fold diacritics, drop dots and apostrophes, lowercase, collapse whitespace. Pure, no Intl. */
export function normPlace(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFKD')) {
    if (/\p{M}/u.test(ch)) continue;
    if (ch === '.' || ch === "'" || ch === '’' || ch === '‘') continue;
    out += /[\p{L}\p{N}]/u.test(ch) ? ch.toLowerCase() : ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

let memo: CompiledPlaceIndex | null = null;
export function defaultPlaceIndex(): PlaceIndex {
  if (memo) return memo;
  const idx = new CompiledPlaceIndex();
  const track = (n: string) => {
    idx.maxTokens = Math.max(idx.maxTokens, n.split(' ').length);
  };
  for (const c of DATA.countries) {
    idx.isoCodes.add(c.code);
    for (const n of [c.name, ...c.aliases]) {
      const k = normPlace(n);
      if (k && !idx.countryByName.has(k)) idx.countryByName.set(k, c.code);
      track(k);
    }
  }
  for (const s of DATA.subdivisions) {
    const e: SubEntry = { country: s.country, code: s.code, name: s.name };
    for (const n of [s.name, ...s.aliases]) {
      const k = normPlace(n);
      push(idx.subByName, k, e);
      track(k);
    }
    if (ABBR_COUNTRIES.has(s.country)) push(idx.subByCode, s.code, e);
  }
  for (const c of DATA.cities) {
    const e: CityEntry = { name: c.name, country: c.country, sub: c.sub ?? null, pop: c.pop };
    for (const n of [c.name, ...(c.aliases ?? [])]) {
      const k = normPlace(n);
      push(idx.cityByName, k, e);
      track(k);
    }
  }
  for (const list of idx.cityByName.values()) list.sort((a, b) => b.pop - a.pop);
  for (const [code, r] of Object.entries(DATA.regions)) {
    idx.regionByName.set(normPlace(code.replace(/_/g, ' ')), code as Region);
    for (const a of r.aliases) {
      idx.regionByName.set(normPlace(a), code as Region);
      track(normPlace(a));
    }
  }
  memo = idx;
  return idx;
}

function asIndex(p: PlaceIndex): CompiledPlaceIndex {
  if (!(p instanceof CompiledPlaceIndex)) {
    throw new EngineInvariantError('places.index.invalid', 'index was not built by defaultPlaceIndex');
  }
  return p;
}

/** True when the string names a place the gazetteer knows (country, region, state or city). Used by canonicalTitle. */
export function isKnownPlace(places: PlaceIndex, s: string): boolean {
  const idx = asIndex(places);
  const n = normPlace(s);
  if (!n) return false;
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((p) => !lookupSpan(idx, p).unknown);
}

// ---------------------------------------------------------------------------------------------
// Part classification

interface PartInfo {
  raw: string;
  unknown: boolean;
  country: string | null;
  isoCode: string | null; // two-letter uppercase token that is an ISO code
  region: Region | null;
  subs: SubEntry[];
  cities: CityEntry[];
  codeSubs: SubEntry[]; // matched through a two/three letter abbreviation
}

function emptyPart(raw: string): PartInfo {
  return { raw, unknown: true, country: null, isoCode: null, region: null, subs: [], cities: [], codeSubs: [] };
}

function lookupSpan(idx: CompiledPlaceIndex, raw: string): PartInfo {
  const info = emptyPart(raw);
  const trimmed = raw.trim();
  const n = normPlace(trimmed);
  if (/^[A-Z]{2,3}$/.test(trimmed)) {
    const cs = idx.subByCode.get(trimmed);
    if (cs) info.codeSubs = cs;
    if (trimmed.length === 2 && idx.isoCodes.has(trimmed)) info.isoCode = trimmed;
  }
  if (n) {
    info.country = idx.countryByName.get(n) ?? null;
    info.region = idx.regionByName.get(n) ?? null;
    info.subs = idx.subByName.get(n) ?? [];
    info.cities = idx.cityByName.get(n) ?? [];
  }
  info.unknown =
    !info.country && !info.region && info.subs.length === 0 && info.cities.length === 0 && info.codeSubs.length === 0 && !info.isoCode;
  return info;
}

/** Exact lookup per comma part, then a rightmost-longest token window for parts with missing commas. */
function parseParts(idx: CompiledPlaceIndex, parts: readonly string[]): PartInfo[] {
  const out: PartInfo[] = [];
  for (const part of parts) {
    const exact = lookupSpan(idx, part);
    if (!exact.unknown) {
      out.push(exact);
      continue;
    }
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      out.push(exact);
      continue;
    }
    const found: PartInfo[] = [];
    let end = tokens.length;
    const pending: PartInfo[] = [];
    while (end > 0) {
      let matched = false;
      for (let len = Math.min(idx.maxTokens, end); len >= 1 && !matched; len--) {
        const span = tokens.slice(end - len, end).join(' ');
        const info = lookupSpan(idx, span);
        if (!info.unknown && (len > 1 || tokens.length > 1)) {
          pending.unshift(info);
          end -= len;
          matched = true;
        }
      }
      if (!matched) end--;
    }
    found.push(...pending);
    if (found.length === 0) out.push(exact);
    else out.push(...found);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Segmenting

interface Segment {
  text: string;
  start: number;
  end: number;
}

function splitSegments(raw: string): Segment[] {
  const out: Segment[] = [];
  let depth = 0;
  let start = 0;
  const flush = (end: number) => {
    const text = raw.slice(start, end);
    const lead = text.length - text.trimStart().length;
    const t = text.trim();
    if (t) out.push({ text: t, start: start + lead, end: start + lead + t.length });
  };
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as string;
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    if (c === '·' || c === '•' || c === ';' || c === '|' || c === '\n') {
      flush(i);
      start = i + 1;
    } else if (c === '/' ) {
      flush(i);
      start = i + 1;
    } else if (c === ' ' && /^ or /i.test(raw.slice(i, i + 4))) {
      flush(i);
      start = i + 4;
      i += 3;
    }
  }
  flush(raw.length);
  return out;
}

const REMOTE_WORDS = /\b(?:remote(?:ly)?|work from home|wfh|home[- ]based|virtual|telecommute|work from anywhere)\b/i;
const WORLDWIDE_WORDS = /^(?:anywhere|worldwide|world wide|global(?:ly)?|distributed|everywhere|any location|work from anywhere|international|remote international)$/i;
const MODE_WORDS = /\b(?:hybrid|on[- ]?site|in[- ]?office|in[- ]person|office[- ]based|hq|headquarters|head office|flexible)\b/gi;

interface Parsed {
  country: string | null;
  /** Extra explicit countries when one unit names several ("Remote (US + Canada)"). */
  more?: string[];
  region: Region | null;
  ruleId: string;
  resolved: boolean;
}

function chooseSub(
  subCands: SubEntry[],
  explicitCountry: string | null,
  cityCands: CityEntry[],
): SubEntry | null {
  let list = subCands;
  if (explicitCountry) list = list.filter((s) => s.country === explicitCountry);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0] as SubEntry;
  const viaCity = list.find((s) => cityCands.some((c) => c.country === s.country && c.sub === s.code));
  if (viaCity) return viaCity;
  const byCountryCity = list.find((s) => cityCands.some((c) => c.country === s.country));
  if (byCountryCity) return byCountryCity;
  for (const cc of ABBR_PRIORITY) {
    const s = list.find((x) => x.country === cc);
    if (s) return s;
  }
  return list[0] as SubEntry;
}

/** Resolve one residual string (no remote/mode words) to a country/region. */
function resolveResidual(idx: CompiledPlaceIndex, residual: string, remoteCtx: boolean): Parsed {
  const rawParts = residual
    .split(/,|\s[-–—]\s|\s[-–—]$|^[-–—]\s/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (rawParts.length === 0) return { country: null, region: null, ruleId: 'place.none', resolved: false };
  const infos = parseParts(idx, rawParts);
  const known = infos.filter((p) => !p.unknown);
  if (known.length === 0) {
    // "US-NYC", "US-SF-HQ": a country-code prefix with an office code.
    const pre = rawParts
      .map((p) => /^([A-Z]{2})[-_][A-Za-z0-9_ -]*$/.exec(p.trim())?.[1])
      .filter((x): x is string => x !== undefined && ['US', 'UK', 'GB', 'IN', 'CA', 'DE', 'FR', 'AU', 'IE', 'SG', 'JP'].includes(x))
      .map((x) => (x === 'UK' ? 'GB' : x));
    if (pre.length > 0) {
      const uniq = [...new Set(pre)];
      return { country: uniq[0] as string, more: uniq.slice(1), region: null, ruleId: 'place.cc_prefix', resolved: true };
    }
    return { country: null, region: null, ruleId: 'place.none', resolved: false };
  }

  // Regions.
  const regionInfo = [...known].reverse().find((p) => p.region !== null && !p.country);
  const countryParts = known.filter((p) => p.country !== null);
  const subParts = known.filter((p) => p.subs.length > 0 || p.codeSubs.length > 0);
  const cityParts = known.filter((p) => p.cities.length > 0);

  if (regionInfo && countryParts.length === 0 && subParts.length === 0 && cityParts.length === 0) {
    return { country: null, region: regionInfo.region, ruleId: 'place.region', resolved: true };
  }

  const distinct = [...new Set(countryParts.map((p) => p.country as string))];
  if (distinct.length >= 2 && cityParts.length === 0) {
    return { country: distinct[0] as string, more: distinct.slice(1), region: null, ruleId: 'place.country_name', resolved: true };
  }

  // Explicit country: rightmost named country, else a two-letter ISO code (only where unambiguous).
  let country: string | null = countryParts.length > 0 ? (countryParts[countryParts.length - 1] as PartInfo).country : null;
  let viaCode = false;
  const allCityCands = cityParts.flatMap((p) => p.cities);
  if (!country) {
    for (let i = known.length - 1; i >= 0; i--) {
      const p = known[i] as PartInfo;
      if (!p.isoCode) continue;
      if (p.codeSubs.length > 0) {
        // Ambiguous token such as CA, DE, IN: a subdivision unless the surrounding city says country or the context is remote.
        const subHit = allCityCands.some((c) => p.codeSubs.some((s) => c.country === s.country && c.sub === s.code));
        const ctryHit = allCityCands.some((c) => c.country === p.isoCode);
        if (subHit) continue;
        if (ctryHit || (remoteCtx && known.length === 1)) {
          country = p.isoCode;
          viaCode = true;
          break;
        }
        continue;
      }
      country = p.isoCode;
      viaCode = true;
      break;
    }
  }

  const subCands = subParts.flatMap((p) => [...p.subs, ...p.codeSubs]);
  const sub = chooseSub(subCands, country, allCityCands);
  let city: CityEntry | null = null;
  if (cityParts.length > 0) {
    for (const p of cityParts) {
      let list = p.cities;
      if (country) list = list.filter((c) => c.country === country);
      if (sub) {
        const bySub = list.filter((c) => c.country === sub.country && (c.sub === sub.code || c.sub === null));
        list = bySub.length > 0 ? bySub : list.filter((c) => c.country === sub.country);
      }
      if (list.length > 0) {
        city = list[0] as CityEntry;
        break;
      }
    }
  }
  if (!country && sub) country = sub.country;
  if (!country && city) country = city.country;
  if (!country && regionInfo) return { country: null, region: regionInfo.region, ruleId: 'place.region', resolved: true };
  if (!country) return { country: null, region: null, ruleId: 'place.none', resolved: false };
  let ruleId: string;
  if (viaCode && countryParts.length === 0 && remoteCtx) ruleId = 'place.remote_cc';
  else if (city && sub) ruleId = 'place.city_state';
  else if (city) ruleId = 'place.city';
  else if (sub) ruleId = 'place.subdivision';
  else ruleId = 'place.country_name';
  return { country, region: null, ruleId, resolved: true };
}

// ---------------------------------------------------------------------------------------------

function onlyKind(infos: PartInfo[]): 'country' | 'city' | null {
  const known = infos.filter((p) => !p.unknown);
  if (known.length < 2 || known.length !== infos.length) return null;
  if (known.every((p) => p.country !== null && p.subs.length === 0 && p.cities.length === 0)) return 'country';
  if (known.every((p) => p.cities.length > 0 && p.subs.length === 0 && !p.country && p.codeSubs.length === 0 && !p.isoCode && !p.region))
    return 'city';
  return null;
}

export function resolveCountries(
  locationsRaw: readonly string[],
  places: PlaceIndex = defaultPlaceIndex(),
  workplace?: Workplace | null,
): CountryResolution {
  const idx = asIndex(places);
  const tb = new TraceBuilder('countries');
  const perLocation: LocationResolution[] = [];
  const unresolved: string[] = [];
  const regions = new Set<Region>();
  const countries = new Set<string>();
  let worldwide = false;
  let regionRemote = false;
  let anyRemote = false;

  const record = (
    index: number,
    raw: string,
    seg: { text: string; start: number; end: number },
    country: string | null,
    region: Region | null,
    remote: boolean,
    ruleId: string,
    label: string,
  ) => {
    perLocation.push({ index, part: seg.text, country, region, remote, ruleId });
    tb.step({
      ruleId,
      op: 'parse',
      label,
      inputs: { index, part: seg.text, remote },
      output: country ?? region ?? null,
      evidence: [evidence('location', raw, seg.start, seg.end, { index })],
    });
  };

  locationsRaw.forEach((raw, index) => {
    for (const seg of splitSegments(raw)) {
      let text = seg.text;
      let remote = false;
      // Parenthetical annotations.
      const parens: string[] = [];
      text = text.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
        parens.push(inner);
        return ' ';
      });
      for (const p of parens) if (REMOTE_WORDS.test(p)) remote = true;
      if (REMOTE_WORDS.test(text)) remote = true;
      let residual = text.replace(new RegExp(REMOTE_WORDS.source, 'gi'), ' ').replace(MODE_WORDS, ' ');
      residual = residual.replace(/\s+/g, ' ').replace(/^[\s,\-–—:]+|[\s,\-–—:]+$/g, '').trim();
      // "Remote (US)": the place only appears inside the parentheses.
      if (!residual) {
        for (const p of parens) {
          const stripped = p.replace(new RegExp(REMOTE_WORDS.source, 'gi'), ' ').replace(MODE_WORDS, ' ').replace(/\s+/g, ' ').trim();
          if (stripped && parseParts(idx, [stripped]).some((i) => !i.unknown)) {
            residual = stripped;
            break;
          }
        }
      }
      if (WORLDWIDE_WORDS.test(residual)) {
        remote = true;
        residual = '';
      }
      if (!residual) {
        if (remote) {
          anyRemote = true;
          worldwide = true;
          record(index, raw, seg, null, null, true, 'place.worldwide', `"${seg.text}" is remote with no place: worldwide`);
        } else {
          unresolved.push(seg.text);
          tb.step({
            ruleId: 'place.unresolved',
            op: 'reject',
            label: `"${seg.text}" names no place`,
            inputs: { index, part: seg.text },
            output: null,
            evidence: [evidence('location', raw, seg.start, seg.end, { index })],
          });
        }
        continue;
      }
      if (remote) anyRemote = true;

      // Several standalone places in one comma list: treat each as its own location.
      const commaParts = residual.split(',').map((p) => p.trim()).filter(Boolean);
      const kind = commaParts.length >= 2 ? onlyKind(parseParts(idx, commaParts)) : null;
      const units = kind ? commaParts : [residual];
      for (const unit of units) {
        const r = resolveResidual(idx, unit, remote);
        if (!r.resolved) {
          unresolved.push(seg.text);
          tb.step({
            ruleId: 'place.unresolved',
            op: 'reject',
            label: `"${unit}" is not in the gazetteer`,
            inputs: { index, part: unit },
            output: null,
            evidence: [evidence('location', raw, seg.start, seg.end, { index })],
          });
          continue;
        }
        if (r.region) {
          regions.add(r.region);
          if (remote) regionRemote = true;
          for (const c of REGION_MEMBERS[r.region]) countries.add(c);
          record(index, raw, seg, null, r.region, remote, r.ruleId, `"${unit}" is the region ${r.region}`);
        } else if (r.country) {
          for (const c of [r.country, ...(r.more ?? [])]) {
            countries.add(c);
            record(index, raw, seg, c, null, remote, r.ruleId, `"${unit}" resolves to ${c}`);
          }
        }
      }
    }
  });

  let remoteScope: CountryResolution['remoteScope'] = 'none';
  if (worldwide) remoteScope = 'worldwide';
  else if (regionRemote) remoteScope = 'region';
  else if (anyRemote) remoteScope = 'countries';
  else if (workplace === 'remote') {
    remoteScope = countries.size > 0 ? 'countries' : 'worldwide';
    tb.step({
      ruleId: 'place.remote_workplace',
      op: 'classify',
      label: `Workplace is remote and no location says so: scope ${remoteScope}`,
      inputs: { workplace },
      output: remoteScope,
    });
  }
  const list = [...countries].sort();
  tb.step({
    ruleId: 'place.countries',
    op: 'merge',
    label: `Countries: ${list.length ? list.join(', ') : 'none'}; remote scope ${remoteScope}`,
    inputs: { countries: list, remoteScope },
    output: list,
  });
  const outcome = list.length > 0 || remoteScope === 'worldwide' ? 'value' : locationsRaw.length === 0 ? 'null' : 'unknown';
  return {
    countries: list,
    remoteScope,
    regions: [...regions].sort(),
    perLocation,
    unresolved,
    trace: tb.build(outcome),
  };
}
