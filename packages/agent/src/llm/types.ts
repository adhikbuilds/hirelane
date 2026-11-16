import type { ZodType } from 'zod';

export type LlmMode = 'anthropic' | 'fixture' | 'off';
export type LlmTier = 'draft' | 'bulk';

/** One posting (or other untrusted text) in a batch. `id` must match /^[A-Za-z0-9_.:-]{1,64}$/. */
export interface BatchItem {
  id: string;
  text: string;
}

export interface ExtractRequest<T> {
  /** e.g. 'salary' | 'requirements' | 'skills'. Logged; also selects the fixture. */
  purpose: string;
  /** Stable instructions. Must not contain job text. Sent as the system prompt so it caches. */
  system: string;
  /** Short per-call instruction placed before the untrusted blocks in the user message. */
  instruction?: string;
  items: readonly BatchItem[];
  /**
   * Output schema. Use the bounded helpers in validate.ts (boundedString, boundedArray, evidenceQuote) and
   * strict objects, then run validateExtraction on the result: ids must be ones we sent and every evidence
   * quote must occur in that item's text. Unvalidated model output must never reach the database.
   */
  schema: ZodType<T>;
  tier?: LlmTier;
  /** The student on whose behalf this runs. Enables the per-student daily limit. */
  userId?: string;
  maxTokens?: number;
}

export type UnavailableReason =
  | 'off'
  | 'spend_cap'
  | 'daily_limit'
  | 'no_fixture'
  | 'empty_batch'
  | 'refusal'
  | 'max_tokens'
  | 'parse_failed'
  | 'rate_limited'
  | 'server_error'
  | 'connection_error'
  | 'client_error'
  | 'error';

export type LlmResult<T> =
  | { status: 'ok'; parsed: T }
  | { status: 'unavailable'; reason: UnavailableReason };

export interface LlmProvider {
  readonly mode: LlmMode;
  readonly available: boolean;
  extract<T>(req: ExtractRequest<T>): Promise<LlmResult<T>>;
  /** Splits req.items into chunks of `chunkSize` and runs one call per chunk, in order. */
  extractBatched<T>(req: ExtractRequest<T>, chunkSize?: number): Promise<LlmResult<T>[]>;
}

export type CallStatus = 'ok' | Exclude<UnavailableReason, 'off' | 'spend_cap' | 'daily_limit' | 'no_fixture' | 'empty_batch'>;

/** A row of llm_calls. Deliberately has no field that could carry prompt or completion text. */
export interface LlmCallRecord {
  purpose: string;
  model: string;
  mode: LlmMode;
  status: CallStatus;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  latencyMs: number;
  batchSize: number;
  /** Estimated, from token counts and a price table. Not a bill. */
  estCostUsd: number;
  userId?: string;
}

export interface LlmCallSink {
  record(call: LlmCallRecord): void | Promise<void>;
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_CHUNK_SIZE = 10;

export async function safeRecord(sink: LlmCallSink | undefined, call: LlmCallRecord): Promise<void> {
  if (!sink) return;
  try {
    await sink.record(call);
  } catch {
    // Telemetry must never break extraction.
  }
}

export async function runChunks<T>(
  req: ExtractRequest<T>,
  chunkSize: number,
  run: (r: ExtractRequest<T>) => Promise<LlmResult<T>>,
): Promise<LlmResult<T>[]> {
  const size = Math.max(1, Math.floor(chunkSize));
  const out: LlmResult<T>[] = [];
  for (let i = 0; i < req.items.length; i += size) {
    out.push(await run({ ...req, items: req.items.slice(i, i + size) }));
  }
  return out;
}
