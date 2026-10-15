/**
 * Task 1.1: RawPosting, the connector contract, normalize() output and the soft-close inputs.
 * Types only, apart from FetchPolicyError. No I/O, no clock, no enrichment.
 *
 * Status of every per-ATS field path is tracked in docs/ingest.md. A path stays an
 * assumption until a test against fixtures/mini confirms it.
 */

export type Ats = 'greenhouse' | 'lever' | 'ashby';
export type IngestMode = 'live' | 'fixture';
export type PostingSource = 'live' | 'fixture';

/** Structured pay as the ATS states it. Major units exactly as given; enrichment converts. */
export interface CompensationHint {
  min: number | null;
  max: number | null;
  currency: string | null;
  interval: 'year' | 'month' | 'week' | 'day' | 'hour' | 'unknown';
  kind: 'salary' | 'ote' | 'other';
  summaryText: string | null;
  source: 'ashby.compensation' | 'lever.salaryRange' | 'greenhouse.pay';
}

/** ATS-agnostic extraction of one board item. Produced by a connector, consumed by normalize(). */
export interface RawPosting {
  ats: Ats;
  boardToken: string;
  externalId: string;
  url: string;
  applyUrl: string | null;
  title: string;
  locationsRaw: string[];
  descriptionHtml: string | null;
  department: string | null;
  team: string | null;
  employmentRaw: string | null;
  workplaceRaw: string | null;
  isRemoteHint: boolean | null;
  postedAt: string | null;
  compensation: CompensationHint | null;
  raw: unknown;
}

/** Subset of WHATWG fetch. The policy wrapper reports policy failures by throwing FetchPolicyError. */
export type BoardFetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<Response>;

export interface FetchBoardOptions {
  mode: IngestMode;
  fetch: BoardFetch;
  signal: AbortSignal;
}

export class FetchPolicyError extends Error {
  constructor(
    public readonly kind: 'timeout' | 'too_large' | 'rate_limited' | 'network',
    public readonly detail: {
      retryAfterMs?: number | null;
      limitBytes?: number;
      bytes?: number;
      cause?: unknown;
    },
  ) {
    super(kind);
    this.name = 'FetchPolicyError';
  }
}

export interface ItemError {
  index: number;
  externalId: string | null;
  reason: 'missing_id' | 'missing_title' | 'bad_url' | 'duplicate_id' | 'item_schema';
  detail?: string;
}

export type FetchBoardError =
  | { kind: 'not_found' }
  | { kind: 'http'; status: number }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'timeout' }
  | { kind: 'aborted' }
  | { kind: 'too_large'; limitBytes: number }
  | { kind: 'network'; message: string }
  | { kind: 'invalid_json'; message: string }
  | { kind: 'schema'; issues: string[] }
  | { kind: 'fixture_missing'; path: string };

export interface FetchBoardOk {
  ok: true;
  ats: Ats;
  token: string;
  source: PostingSource;
  postings: RawPosting[];
  seenExternalIds: string[];
  itemErrors: ItemError[];
  unlistedCount: number;
  httpStatus: number | null;
  bytes: number;
  durationMs: number;
}

export interface FetchBoardErr {
  ok: false;
  ats: Ats;
  token: string;
  error: FetchBoardError;
  httpStatus: number | null;
  bytes: number;
  durationMs: number;
}

export type FetchBoardResult = FetchBoardOk | FetchBoardErr;

export interface Connector {
  ats: Ats;
  boardUrl(token: string): string;
  fetchBoard(token: string, opts: FetchBoardOptions): Promise<FetchBoardResult>;
}

export interface BoardRef {
  id: string;
  ats: Ats;
  token: string;
}

/** 1:1 with the insertable/updatable columns of `postings`. Persistence owns the seen/closed columns. */
export interface NormalizedPosting {
  boardId: string;
  externalId: string;
  key: string;
  url: string;
  applyUrl: string | null;
  title: string;
  locationRaw: string | null;
  raw: unknown;
  contentHash: string;
  postedAt: Date | null;
  source: PostingSource;
}

export type NormalizeResult =
  | { ok: true; posting: NormalizedPosting }
  | { ok: false; externalId: string; reason: 'missing_title' | 'bad_url' | 'key_too_long' };
