import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { buildUserMessage } from './prompt.js';
import type {
  CallStatus, ExtractRequest, LlmCallSink, LlmMode, LlmProvider, LlmResult, LlmTier, UnavailableReason,
} from './types.js';
import { DEFAULT_CHUNK_SIZE, runChunks, safeRecord } from './types.js';

/** The slice of the SDK client we use, so tests can inject a mock. */
export interface ParseClient {
  messages: { parse(params: any): Promise<any> };
}

export interface AnthropicProviderOptions {
  client: ParseClient;
  models: Record<LlmTier, string>;
  sink?: LlmCallSink;
  /** Monotonic millisecond clock, injectable for tests. */
  now?: () => number;
}

const EFFORT: Record<LlmTier, 'low' | 'medium'> = { bulk: 'low', draft: 'medium' };

function classify(err: unknown): UnavailableReason {
  if (err instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (err instanceof Anthropic.APIConnectionError) return 'connection_error';
  if (err instanceof Anthropic.APIError) {
    const s = err.status;
    if (typeof s === 'number' && s >= 500) return 'server_error';
    return 'client_error';
  }
  return 'error';
}

export class AnthropicProvider implements LlmProvider {
  readonly mode: LlmMode = 'anthropic';
  readonly available = true;
  private readonly now: () => number;

  constructor(private readonly opts: AnthropicProviderOptions) {
    this.now = opts.now ?? (() => performance.now());
  }

  async extract<T>(req: ExtractRequest<T>): Promise<LlmResult<T>> {
    if (req.items.length === 0) return { status: 'unavailable', reason: 'empty_batch' };
    const tier = req.tier ?? 'bulk';
    const model = this.opts.models[tier];
    const log = {
      purpose: req.purpose, model, mode: 'anthropic' as const, batchSize: req.items.length,
    };
    const user = buildUserMessage(req.instruction ?? 'Extract the requested fields.', req.items);
    const started = this.now();
    let message: any;
    try {
      message = await this.opts.client.messages.parse({
        model,
        max_tokens: req.maxTokens ?? 16000,
        // Stable system prompt first (cached); untrusted per-job text only in the user message.
        system: req.system,
        cache_control: { type: 'ephemeral' },
        messages: [{ role: 'user', content: user }],
        output_config: { effort: EFFORT[tier], format: zodOutputFormat(req.schema) },
      });
    } catch (err) {
      const reason = classify(err);
      await safeRecord(this.opts.sink, {
        ...log, status: reason as CallStatus, inputTokens: 0, outputTokens: 0,
        cacheReadTokens: 0, cacheCreationTokens: 0, latencyMs: Math.round(this.now() - started),
      });
      return { status: 'unavailable', reason };
    }
    const u = message?.usage ?? {};
    let status: CallStatus = 'ok';
    let reason: UnavailableReason | null = null;
    if (message?.stop_reason === 'refusal') (status = 'refusal'), (reason = 'refusal');
    else if (message?.stop_reason === 'max_tokens') (status = 'max_tokens'), (reason = 'max_tokens');
    else if (message?.parsed_output == null) (status = 'parse_failed'), (reason = 'parse_failed');
    await safeRecord(this.opts.sink, {
      ...log, status,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      latencyMs: Math.round(this.now() - started),
    });
    if (reason) return { status: 'unavailable', reason };
    return { status: 'ok', parsed: message.parsed_output as T };
  }

  extractBatched<T>(req: ExtractRequest<T>, chunkSize = DEFAULT_CHUNK_SIZE): Promise<LlmResult<T>[]> {
    return runChunks(req, chunkSize, (r) => this.extract(r));
  }
}
