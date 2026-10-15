import type { ExtractRequest, LlmCallSink, LlmMode, LlmProvider, LlmResult } from './types.js';
import { DEFAULT_CHUNK_SIZE, DEFAULT_MODEL, runChunks, safeRecord } from './types.js';

export type FixtureHandler = object | string | number | boolean | null | ((req: ExtractRequest<any>) => unknown);

/** Deterministic provider for tests and offline dev. Fixtures are keyed by purpose. */
export class FixtureProvider implements LlmProvider {
  readonly mode: LlmMode = 'fixture';
  readonly available = true;
  constructor(
    private readonly fixtures: Record<string, FixtureHandler> = {},
    private readonly sink?: LlmCallSink,
  ) {}

  async extract<T>(req: ExtractRequest<T>): Promise<LlmResult<T>> {
    if (req.items.length === 0) return { status: 'unavailable', reason: 'empty_batch' };
    if (!Object.hasOwn(this.fixtures, req.purpose)) return { status: 'unavailable', reason: 'no_fixture' };
    const h = this.fixtures[req.purpose];
    const raw = typeof h === 'function' ? (h as (r: ExtractRequest<unknown>) => unknown)(req as ExtractRequest<unknown>) : h;
    const checked = req.schema.safeParse(raw);
    const base = {
      purpose: req.purpose, model: DEFAULT_MODEL, mode: 'fixture' as const,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
      latencyMs: 0, batchSize: req.items.length,
    };
    if (!checked.success) {
      await safeRecord(this.sink, { ...base, status: 'parse_failed' });
      return { status: 'unavailable', reason: 'parse_failed' };
    }
    await safeRecord(this.sink, { ...base, status: 'ok' });
    return { status: 'ok', parsed: checked.data };
  }

  extractBatched<T>(req: ExtractRequest<T>, chunkSize = DEFAULT_CHUNK_SIZE): Promise<LlmResult<T>[]> {
    return runChunks(req, chunkSize, (r) => this.extract(r));
  }
}
