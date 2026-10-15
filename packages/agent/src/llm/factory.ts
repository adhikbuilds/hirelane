import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider, type ParseClient } from './anthropic.js';
import { FixtureProvider, type FixtureHandler } from './fixture.js';
import { NullProvider } from './null.js';
import { DEFAULT_MODEL, type LlmCallSink, type LlmMode, type LlmProvider, type LlmTier } from './types.js';

type Env = Record<string, string | undefined>;

/**
 * HIRELANE_LLM_MODE = anthropic | fixture | off. Unset: anthropic when ANTHROPIC_API_KEY is set,
 * otherwise off. An explicit anthropic without a key degrades to off (the app must run keyless).
 */
export function resolveLlmMode(env: Env = process.env): LlmMode {
  const hasKey = (env.ANTHROPIC_API_KEY ?? '').trim() !== '';
  const raw = (env.HIRELANE_LLM_MODE ?? '').trim().toLowerCase();
  if (raw === '') return hasKey ? 'anthropic' : 'off';
  if (raw === 'fixture') return 'fixture';
  if (raw === 'anthropic') return hasKey ? 'anthropic' : 'off';
  return 'off';
}

export function resolveModels(env: Env = process.env): Record<LlmTier, string> {
  const pick = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : DEFAULT_MODEL);
  return { draft: pick(env.HIRELANE_MODEL_DRAFT), bulk: pick(env.HIRELANE_MODEL_BULK) };
}

export interface CreateProviderOptions {
  env?: Env;
  sink?: LlmCallSink;
  fixtures?: Record<string, FixtureHandler>;
  /** Injected SDK client (tests). Defaults to `new Anthropic()`. */
  client?: ParseClient;
}

export function createLlmProvider(opts: CreateProviderOptions = {}): LlmProvider {
  const env = opts.env ?? process.env;
  switch (resolveLlmMode(env)) {
    case 'anthropic':
      return new AnthropicProvider({
        client: opts.client ?? (new Anthropic() as unknown as ParseClient),
        models: resolveModels(env),
        sink: opts.sink,
      });
    case 'fixture':
      return new FixtureProvider(opts.fixtures ?? {}, opts.sink);
    default:
      return new NullProvider();
  }
}
