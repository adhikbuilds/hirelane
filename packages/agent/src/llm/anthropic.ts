import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { assertAllowedModel, estimateCostUsd, type LlmLimits, type UsageStore } from './config.js';
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
  /** Spend cap and daily limit. Requires `usage`. The factory always supplies both. */
  limits?: LlmLimits;
  usage?: UsageStore;
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
    assertAllowedModel('HIRELANE_MODEL_DRAFT', opts.models.draft);
    assertAllowedModel('HIRELANE_MODEL_BULK', opts.models.bulk);
    if (opts.limits && !opts.usage) throw new Error('AnthropicProvider: limits require a usage store');
    this.now = opts.now ?? (() => performance.now());
  }

  async extract<T>(req: ExtractRequest<T>): Promise<LlmResult<T>> {
    if (req.items.length === 0) return { status: 'unavailable', reason: 'empty_batch' };
    const tier = req.tier ?? 'bulk';
    const model = this.opts.models[tier];
    const log = {
      purpose: req.purpose, model, mode: 'anthropic' as const, batchSize: req.items.length,
      ...(req.userId ? { userId: req.userId } : {}),
    };
    const at = new Date();
    const gate = await this.gate(req.userId, at);
    if (gate) return { status: 'unavailable', reason: gate };
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
        cacheReadTokens: 0, cacheCreationTokens: 0, estCostUsd: 0, latencyMs: Math.round(this.now() - started),
      });
      await this.note(req.userId, at);
      return { status: 'unavailable', reason };
    }
    const u = message?.usage ?? {};
    let status: CallStatus = 'ok';
    let reason: UnavailableReason | null = null;
    if (message?.stop_reason === 'refusal') (status = 'refusal'), (reason = 'refusal');
    else if (message?.stop_reason === 'max_tokens') (status = 'max_tokens'), (reason = 'max_tokens');
    else if (message?.parsed_output == null) (status = 'parse_failed'), (reason = 'parse_failed');
    const tokens = {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    };
    await safeRecord(this.opts.sink, {
      ...log, status, ...tokens,
      estCostUsd: estimateCostUsd(model, tokens),
      latencyMs: Math.round(this.now() - started),
    });
    await this.note(req.userId, at);
    if (reason) return { status: 'unavailable', reason };
    return { status: 'ok', parsed: message.parsed_output as T };
  }

  /** Returns why the call must not happen, or null. Fails closed if the counters cannot be read. */
  private async gate(userId: string | undefined, at: Date): Promise<UnavailableReason | null> {
    const { limits, usage } = this.opts;
    if (!limits || !usage) return null;
    try {
      if (limits.monthlyUsd <= 0 || (await usage.monthSpendUsd(at)) >= limits.monthlyUsd) return 'spend_cap';
      if (userId !== undefined && (limits.dailyPerUser <= 0 || (await usage.userCallsToday(userId, at)) >= limits.dailyPerUser)) return 'daily_limit';
      return null;
    } catch {
      return 'error';
    }
  }

  private async note(userId: string | undefined, at: Date): Promise<void> {
    try {
      await this.opts.usage?.noteCall(userId, at);
    } catch {
      // Counting must not break extraction; the next gate check fails closed if the store is down.
    }
  }

  extractBatched<T>(req: ExtractRequest<T>, chunkSize = DEFAULT_CHUNK_SIZE): Promise<LlmResult<T>[]> {
    return runChunks(req, chunkSize, (r) => this.extract(r));
  }
}
