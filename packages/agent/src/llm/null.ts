import type { ExtractRequest, LlmMode, LlmProvider, LlmResult } from './types.js';
import { DEFAULT_CHUNK_SIZE, runChunks } from './types.js';

/** LLM disabled: every call is unavailable, nothing is logged, nothing leaves the process. */
export class NullProvider implements LlmProvider {
  readonly mode: LlmMode = 'off';
  readonly available = false;
  async extract<T>(_req: ExtractRequest<T>): Promise<LlmResult<T>> {
    return { status: 'unavailable', reason: 'off' };
  }
  extractBatched<T>(req: ExtractRequest<T>, chunkSize = DEFAULT_CHUNK_SIZE): Promise<LlmResult<T>[]> {
    return runChunks(req, chunkSize, (r) => this.extract(r));
  }
}
