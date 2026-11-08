/**
 * schema.org JobPosting (as parsed from JSON-LD) to our RawPosting. Pure: the clock is injected.
 * Salary is taken only from `baseSalary` and never inferred from text. Page HTML never reaches this function.
 */
import { createHash } from 'node:crypto';
import type { CompensationHint, RawPosting } from '../contract';
import { decodeEntitiesOnce, collapseWs, httpsUrl, toIsoUtc, trimOrNull } from '../connectors/shared';
import { detectIndia, isIndiaCountry, type IndiaDetection, type StructuredLocation } from './india';

export interface ParseContext {
  pageUrl: string;
  host: string;
  now: Date;
}

export type ParseResult =
  | { kind: 'ok'; posting: RawPosting; india: IndiaDetection; company: string | null }
  | { kind: 'expired' | 'missing_title' | 'bad_url' };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string | undefined => {
  if (typeof v === 'string') return trimOrNull(v) ?? undefined;
  if (typeof v === 'number') return String(v);
  if (isObj(v)) return text(v['name'] ?? v['value']);
  return undefined;
};

function countryOf(v: unknown): string | undefined {
  const t = text(v);
  return t && isIndiaCountry(t) ? 'India' : t;
}

function locationOf(place: unknown): StructuredLocation | null {
  if (typeof place === 'string') return trimOrNull(place) ? { text: place.trim() } : null;
  if (!isObj(place)) return null;
  const a = place['address'];
  if (typeof a === 'string') return trimOrNull(a) ? { text: a.trim() } : null;
  if (!isObj(a)) return null;
  const loc: StructuredLocation = {
    city: text(a['addressLocality']),
    region: text(a['addressRegion']),
    country: countryOf(a['addressCountry']),
  };
  return loc.city || loc.region || loc.country ? loc : null;
}

const fmt = (l: StructuredLocation): string => (l.text ? l.text : [l.city, l.region, l.country].filter(Boolean).join(', '));

const EMPLOYMENT: Record<string, string> = {
  FULL_TIME: 'Full-time', PART_TIME: 'Part-time', CONTRACTOR: 'Contract', TEMPORARY: 'Temporary', INTERN: 'Internship',
  VOLUNTEER: 'Volunteer', PER_DIEM: 'Per diem',
};

const UNIT: Record<string, CompensationHint['interval']> = { YEAR: 'year', MONTH: 'month', WEEK: 'week', DAY: 'day', HOUR: 'hour' };

function money(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(/[,\s_]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function compensation(b: unknown): CompensationHint | null {
  if (!isObj(b)) return null;
  const currency = trimOrNull(b['currency']);
  const v = b['value'];
  let min: number | null;
  let max: number | null;
  let unit: unknown;
  if (isObj(v)) {
    const single = money(v['value']);
    min = money(v['minValue']) ?? single;
    max = money(v['maxValue']) ?? single;
    unit = v['unitText'];
  } else {
    min = max = money(v);
  }
  if (min === null && max === null) return null;
  if (min === null) min = max;
  if (max === null) max = min;
  const interval = typeof unit === 'string' ? (UNIT[unit.trim().toUpperCase()] ?? 'unknown') : 'unknown';
  return { min, max, currency: currency ? currency.toUpperCase() : null, interval, kind: 'salary', summaryText: null, source: 'jsonld.baseSalary' };
}

/** `2027-01-31T23:59` (no zone) is read as UTC, not the server's local zone. */
function when(v: unknown): string | null {
  if (typeof v === 'string' && /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v.trim())) return toIsoUtc(`${v.trim()}Z`);
  return toIsoUtc(v);
}

function stableId(jp: Obj, pageUrl: string): string {
  const raw = jp['identifier'];
  const id = isObj(raw) ? text(raw['value']) : text(raw); // PropertyValue: `value` is the id, `name` is the issuer
  let ext = id ?? new URL(pageUrl).pathname.replace(/\/+$/, '');
  if (ext.length > 120) ext = `h:${createHash('sha1').update(ext).digest('hex').slice(0, 24)}`;
  return ext;
}

function description(v: unknown): string | null {
  const s = typeof v === 'string' ? v : null;
  if (!s || s.trim() === '') return null;
  return !s.includes('<') && /&lt;\w/.test(s) ? decodeEntitiesOnce(s) : s;
}

export function parseJobPosting(jp: Obj, ctx: ParseContext): ParseResult {
  const title = collapseWs(decodeEntitiesOnce(text(jp['title']) ?? text(jp['name']) ?? ''));
  if (!title) return { kind: 'missing_title' };
  const url = httpsUrl(ctx.pageUrl);
  if (!url) return { kind: 'bad_url' };

  const validThrough = when(jp['validThrough']);
  if (validThrough && Date.parse(validThrough) <= ctx.now.getTime()) return { kind: 'expired' };

  const places = asArray(jp['jobLocation']).map(locationOf).filter((l): l is StructuredLocation => l !== null);
  const remote = String(jp['jobLocationType'] ?? '').toUpperCase() === 'TELECOMMUTE';
  const applicant: StructuredLocation[] = asArray(jp['applicantLocationRequirements'])
    .map((a) => text(a))
    .filter((t): t is string => !!t)
    .map((t) => ({ country: isIndiaCountry(t) ? 'India' : t }));
  const locs = places.length ? places : remote ? applicant : [];
  const locationsRaw = [...new Set(locs.map(fmt).filter(Boolean))];

  const types = asArray(jp['employmentType']).map((t) => EMPLOYMENT[String(t).trim().toUpperCase()]).filter((t): t is string => !!t);
  const org = jp['hiringOrganization'];
  const company = isObj(org) ? (text(org['name']) ?? null) : (text(org) ?? null);

  const posting: RawPosting = {
    ats: 'jsonld',
    boardToken: ctx.host,
    externalId: stableId(jp, url),
    url,
    applyUrl: httpsUrl(jp['url']) ?? null,
    title,
    locationsRaw,
    descriptionHtml: description(jp['description']),
    department: trimOrNull(typeof jp['occupationalCategory'] === 'string' ? jp['occupationalCategory'] : null),
    team: null,
    employmentRaw: types.length ? [...new Set(types)].join(', ') : null,
    workplaceRaw: remote ? 'remote' : null,
    isRemoteHint: remote ? true : null,
    postedAt: when(jp['datePosted']),
    validThrough,
    compensation: compensation(jp['baseSalary']),
    raw: jp,
  };
  return { kind: 'ok', posting, india: detectIndia([...places, ...(remote ? applicant : [])]), company };
}
