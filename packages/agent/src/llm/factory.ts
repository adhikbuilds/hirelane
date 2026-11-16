import Anthropic from '@anthropic-ai/sdk';
import { LlmConfigError } from './config.js';
import { AnthropicProvider, type ParseClient } from './anthropic.js';
import { FixtureProvider, type FixtureHandler } from './fixture.js';
import { NullProvider } from './null.js';
import { assertAllowedModel, BULK_MODEL, DRAFT_MODEL, resolveLlmLimits, resolveLlmSwitch, type UsageStore } from './config.js';
import { type LlmCallSink, type LlmMode, type LlmProvider, type LlmTier } from './types.js';

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
  const pick = (name: string, v: string | undefined, dflt: string) =>
    assertAllowedModel(name, v && v.trim() !== '' ? v.trim() : dflt);
  return {
    draft: pick('HIRELANE_MODEL_DRAFT', env.HIRELANE_MODEL_DRAFT, DRAFT_MODEL),
    bulk: pick('HIRELANE_MODEL_BULK', env.HIRELANE_MODEL_BULK, BULK_MODEL),
  };
}

export interface CreateProviderOptions {
  env?: Env;
  sink?: LlmCallSink;
  fixtures?: Record<string, FixtureHandler>;
  /** Injected SDK client (tests). Defaults to `new Anthropic()`. */
  client?: ParseClient;
  /** Builds the SDK client from the server-side key. Only called when calls are enabled. */
  makeClient?: (apiKey: string) => ParseClient;
  /** Spend and daily counters. Required when HIRELANE_LLM_MONTHLY_USD > 0. */
  usage?: UsageStore;
}

export function createLlmProvider(opts: CreateProviderOptions = {}): LlmProvider {
  const env = opts.env ?? process.env;
  // Validate first so a bad model or limit fails at startup, whatever the switch says.
  const models = resolveModels(env);
  const limits = resolveLlmLimits(env);
  const mode = resolveLlmMode(env);
  if (mode === 'fixture') return new FixtureProvider(opts.fixtures ?? {}, opts.sink);
  // Real calls need the explicit switch (never on in demo) plus a key. Otherwise no client is built.
  if (mode !== 'anthropic' || resolveLlmSwitch(env) !== 'on') return new NullProvider();
  if (limits.monthlyUsd > 0 && !opts.usage) {
    throw new LlmConfigError('HIRELANE_LLM_MONTHLY_USD', 'a usage store is required to enforce the spend cap');
  }
  const key = (env.ANTHROPIC_API_KEY ?? '').trim();
  const client = opts.client ?? (opts.makeClient ?? ((k) => new Anthropic({ apiKey: k }) as unknown as ParseClient))(key);
  return new AnthropicProvider({ client, models, sink: opts.sink, limits, usage: opts.usage });
}
