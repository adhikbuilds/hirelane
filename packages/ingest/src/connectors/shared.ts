import { z } from 'zod';
import {
  FetchPolicyError,
  type Ats,
  type Connector,
  type FetchBoardError,
  type FetchBoardOptions,
  type FetchBoardResult,
  type ItemError,
  type RawPosting,
} from '../contract';

export const TOKEN_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Throws on a token that is not a plain slug. Tokens come from config only; this is the SSRF backstop. */
export function assertToken(token: string): string {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new Error(`invalid board token: ${JSON.stringify(token)}`);
  return encodeURIComponent(token);
}

// ---------- text helpers ----------

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodes HTML entities in ONE pass, so "&amp;nbsp;" becomes "&nbsp;" and never " ". */
export function decodeEntitiesOnce(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (m, dec, hex, name) => {
    if (dec !== undefined || hex !== undefined) {
      const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
    }
    return NAMED[name as string] ?? m;
  });
}

export const collapseWs = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Trimmed, whitespace-collapsed, entity-decoded-once title; '' when absent. */
export function cleanTitle(v: unknown): string {
  return typeof v === 'string' ? collapseWs(decodeEntitiesOnce(v)) : '';
}

export function trimOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** Primary first, then secondaries; trimmed, empties and exact duplicates dropped, order kept. */
export function mergeLocations(...groups: unknown[][]): string[] {
  const out: string[] = [];
  for (const g of groups) for (const v of g) {
    const t = trimOrNull(v);
    if (t !== null && !out.includes(t)) out.push(t);
  }
  return out;
}

export const httpsUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  try {
    return new URL(v.trim()).protocol === 'https:' ? v.trim() : null;
  } catch {
    return null;
  }
};

/** Shared timestamp rule: >= 1e12 is epoch ms, smaller numbers are epoch s, strings go through Date.parse. */
export function toIsoUtc(v: unknown): string | null {
  let ms: number;
  if (typeof v === 'number') ms = v >= 1e12 ? v : v * 1000;
  else if (typeof v === 'string' && v.trim() !== '') ms = Date.parse(v);
  else return null;
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (Number.isNaN(y) || y < 2000 || y > 2100) return null;
  return d.toISOString();
}

// ---------- generic board fetch ----------

export type ItemOutcome =
  | { kind: 'posting'; posting: RawPosting }
  | { kind: 'unlisted' }
  | { kind: 'error'; reason: ItemError['reason']; detail?: string };

export interface AtsSpec {
  ats: Ats;
  boardUrl(token: string): string;
  /** Validates the top level and returns the item list, or the issues. */
  envelope(body: unknown): { items: unknown[] } | { issues: string[] };
  /** The ATS-native id of an item, or null when it cannot be identified. */
  idOf(item: unknown): string | null;
  /** Called for items with an id. Unlisted items are excluded from the seen set before this runs. */
  isUnlisted?(item: unknown): boolean;
  extract(item: unknown, token: string, externalId: string): ItemOutcome;
}

export const zodIssues = (e: z.ZodError): string[] =>
  e.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null; // HTTP-date form is relative to now by definition
}

function mapPolicy(e: FetchPolicyError): FetchBoardError {
  switch (e.kind) {
    case 'timeout':
      return { kind: 'timeout' };
    case 'too_large':
      return { kind: 'too_large', limitBytes: e.detail.limitBytes ?? 0 };
    case 'rate_limited':
      return { kind: 'rate_limited', retryAfterMs: e.detail.retryAfterMs ?? null };
    default:
      return { kind: 'network', message: e.detail.cause instanceof Error ? e.detail.cause.message : 'network error' };
  }
}

export function makeConnector(spec: AtsSpec): Connector {
  const { ats } = spec;
  return {
    ats,
    boardUrl: (token) => spec.boardUrl(assertToken(token)),
    async fetchBoard(token: string, opts: FetchBoardOptions): Promise<FetchBoardResult> {
      const url = spec.boardUrl(assertToken(token)); // programmer error if the token is invalid
      const t0 = performance.now();
      const fail = (error: FetchBoardError, httpStatus: number | null = null, bytes = 0): FetchBoardResult => ({
        ok: false, ats, token, error, httpStatus, bytes, durationMs: Math.round(performance.now() - t0),
      });

      let res: Response;
      try {
        res = await opts.fetch(url, { signal: opts.signal, headers: { accept: 'application/json' } });
      } catch (e) {
        if (e instanceof FetchPolicyError) return fail(mapPolicy(e));
        if (opts.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return fail({ kind: 'aborted' });
        return fail({ kind: 'network', message: e instanceof Error ? e.message : String(e) });
      }

      const status = res.status;
      if (status === 404) { void res.body?.cancel().catch(() => {}); return fail({ kind: 'not_found' }, status); }
      if (status === 429) {
        void res.body?.cancel().catch(() => {});
        return fail({ kind: 'rate_limited', retryAfterMs: parseRetryAfter(res.headers.get('retry-after')) }, status);
      }
      if (status < 200 || status >= 300) { void res.body?.cancel().catch(() => {}); return fail({ kind: 'http', status }, status); }

      let text: string;
      try {
        text = await res.text();
      } catch (e) {
        if (e instanceof FetchPolicyError) return fail(mapPolicy(e), status);
        if (opts.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return fail({ kind: 'aborted' }, status);
        return fail({ kind: 'network', message: e instanceof Error ? e.message : String(e) }, status);
      }
      const bytes = Buffer.byteLength(text);

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch (e) {
        return fail({ kind: 'invalid_json', message: e instanceof Error ? e.message : String(e) }, status, bytes);
      }

      const env = spec.envelope(body);
      if ('issues' in env) return fail({ kind: 'schema', issues: env.issues }, status, bytes);

      const postings: RawPosting[] = [];
      const seen = new Set<string>();
      const itemErrors: ItemError[] = [];
      const taken = new Set<string>();
      let unlistedCount = 0;

      env.items.forEach((item, index) => {
        const id = isRecord(item) ? spec.idOf(item) : null;
        if (id === null) {
          itemErrors.push({ index, externalId: null, reason: isRecord(item) ? 'missing_id' : 'item_schema' });
          return;
        }
        if (spec.isUnlisted?.(item)) { unlistedCount++; return; }
        seen.add(id);
        if (taken.has(id)) { itemErrors.push({ index, externalId: id, reason: 'duplicate_id' }); return; }
        taken.add(id);
        const out = spec.extract(item, token, id);
        if (out.kind === 'posting') postings.push(out.posting);
        else if (out.kind === 'error') itemErrors.push({ index, externalId: id, reason: out.reason, ...(out.detail ? { detail: out.detail } : {}) });
      });

      return {
        ok: true, ats, token, source: opts.mode, postings, seenExternalIds: [...seen], itemErrors,
        unlistedCount, httpStatus: status, bytes, durationMs: Math.round(performance.now() - t0),
      };
    },
  };
}

// ---------- shared zod bits ----------

export const nullableString = z.string().nullish();
export const topLevelArray = z.array(z.unknown());
export { z };
