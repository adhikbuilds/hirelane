import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ALLOWED_MODELS, AnthropicProvider, createLlmProvider, LlmConfigError, NullProvider, resolveLlmLimits,
  resolveLlmSwitch, resolveModels, type LlmCallRecord, type UsageStore,
} from '../src/llm/index.js';

const Schema = z.object({ results: z.array(z.object({ id: z.string() })) });
const req = { purpose: 'requirements', system: 'S', schema: Schema, items: [{ id: 'a', text: 'T' }] };
const ok = {
  stop_reason: 'end_turn', parsed_output: { results: [{ id: 'a' }] },
  usage: { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
};

describe('model defaults and allow-list', () => {
  it('defaults draft to sonnet and bulk to haiku', () => {
    expect(resolveModels({})).toEqual({ draft: 'claude-sonnet-5-5', bulk: 'claude-haiku-5-5' });
  });
  it('allows exactly two ids', () => {
    expect([...ALLOWED_MODELS].sort()).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
  });
  it('treats blank overrides as unset', () => {
    expect(resolveModels({ HIRELANE_MODEL_DRAFT: ' ', HIRELANE_MODEL_BULK: '' })).toEqual({
      draft: 'claude-sonnet-5-5', bulk: 'claude-haiku-5-5',
    });
  });
  it('accepts either allowed id on either tier', () => {
    expect(resolveModels({ HIRELANE_MODEL_DRAFT: 'claude-haiku-5-5', HIRELANE_MODEL_BULK: 'claude-sonnet-5-5' }))
      .toEqual({ draft: 'claude-haiku-5-5', bulk: 'claude-sonnet-5-5' });
  });
  it.each(['claude-opus-5-5', 'claude-opus-4-1', 'Claude-Sonnet-5-5x', 'gpt-5', 'x'])('rejects %s naming the variable', (id) => {
    expect(() => resolveModels({ HIRELANE_MODEL_DRAFT: id })).toThrow(LlmConfigError);
    expect(() => resolveModels({ HIRELANE_MODEL_DRAFT: id })).toThrow(/HIRELANE_MODEL_DRAFT/);
    expect(() => resolveModels({ HIRELANE_MODEL_BULK: id })).toThrow(/HIRELANE_MODEL_BULK/);
  });
  it('createLlmProvider fails at startup on a bad model even when the switch is off', () => {
    expect(() => createLlmProvider({ env: { HIRELANE_MODEL_BULK: 'claude-opus-5-5' } })).toThrow(/HIRELANE_MODEL_BULK/);
  });
  it('AnthropicProvider rejects a disallowed model passed directly', () => {
    expect(() => new AnthropicProvider({ client: { messages: { parse: vi.fn() } }, models: { draft: 'claude-opus-5-5', bulk: 'claude-haiku-5-5' } })).toThrow(LlmConfigError);
  });
});

describe('HIRELANE_LLM switch', () => {
  it('defaults off', () => expect(resolveLlmSwitch({})).toBe('off'));
  it('is on only for "on"', () => {
    expect(resolveLlmSwitch({ HIRELANE_LLM: ' ON ' })).toBe('on');
    expect(resolveLlmSwitch({ HIRELANE_LLM: 'true' })).toBe('off');
    expect(resolveLlmSwitch({ HIRELANE_LLM: '1' })).toBe('off');
  });
  it('is forced off when HIRELANE_DEMO=1', () => {
    expect(resolveLlmSwitch({ HIRELANE_LLM: 'on', HIRELANE_DEMO: '1' })).toBe('off');
  });
  it('builds no Anthropic client and returns llm off when off', async () => {
    const client = vi.fn();
    const p = createLlmProvider({ env: { HIRELANE_LLM: 'off', HIRELANE_LLM_MODE: 'anthropic', ANTHROPIC_API_KEY: 'k' }, client: client as never });
    expect(p).toBeInstanceOf(NullProvider);
    expect(await p.extract(req)).toEqual({ status: 'unavailable', reason: 'off' });
    expect(client).not.toHaveBeenCalled();
  });
  it('a key alone (switch unset) no longer enables calls', () => {
    expect(createLlmProvider({ env: { ANTHROPIC_API_KEY: 'k' } })).toBeInstanceOf(NullProvider);
  });
  it('demo forces off even with on + key', () => {
    expect(createLlmProvider({ env: { HIRELANE_LLM: 'on', HIRELANE_DEMO: '1', ANTHROPIC_API_KEY: 'k' } })).toBeInstanceOf(NullProvider);
  });
  it('on without a key degrades to off', () => {
    expect(createLlmProvider({ env: { HIRELANE_LLM: 'on' } })).toBeInstanceOf(NullProvider);
  });
  it('on with key builds the real provider, passing the key from env only to the client factory', () => {
    const makeClient = vi.fn(() => ({ messages: { parse: vi.fn() } }));
    const p = createLlmProvider({
      env: { HIRELANE_LLM: 'on', ANTHROPIC_API_KEY: 'sk-secret', HIRELANE_LLM_MONTHLY_USD: '5' },
      usage: fakeStore(), makeClient: makeClient as never,
    });
    expect(p.mode).toBe('anthropic');
    expect(makeClient).toHaveBeenCalledWith('sk-secret');
  });
  it('on with a cap but no usage store fails at startup', () => {
    expect(() => createLlmProvider({ env: { HIRELANE_LLM: 'on', ANTHROPIC_API_KEY: 'k', HIRELANE_LLM_MONTHLY_USD: '5' } })).toThrow(/usage/i);
  });
});

describe('limits parsing', () => {
  it('defaults to cap 0 and 20 per day', () => {
    expect(resolveLlmLimits({})).toEqual({ monthlyUsd: 0, dailyPerUser: 20 });
  });
  it('reads values', () => {
    expect(resolveLlmLimits({ HIRELANE_LLM_MONTHLY_USD: '12.5', HIRELANE_LLM_DAILY_PER_USER: '3' })).toEqual({ monthlyUsd: 12.5, dailyPerUser: 3 });
  });
  it.each([['HIRELANE_LLM_MONTHLY_USD', '-1'], ['HIRELANE_LLM_MONTHLY_USD', 'abc'], ['HIRELANE_LLM_DAILY_PER_USER', '1.5'], ['HIRELANE_LLM_DAILY_PER_USER', '-2']])('rejects %s=%s naming it', (k, v) => {
    expect(() => resolveLlmLimits({ [k]: v })).toThrow(new RegExp(k));
  });
  it('never echoes the API key in config errors', () => {
    try { resolveModels({ HIRELANE_MODEL_DRAFT: 'sk-ant-leak', ANTHROPIC_API_KEY: 'sk-ant-key' }); } catch (e) {
      expect(String(e)).not.toContain('sk-ant-key');
    }
  });
});

function fakeStore(over: Partial<UsageStore> = {}): UsageStore & { noted: unknown[] } {
  const noted: unknown[] = [];
  return {
    noted,
    monthSpendUsd: async () => 0,
    userCallsToday: async () => 0,
    noteCall: async (u, at) => void noted.push([u, at]),
    ...over,
  };
}

function build(limits: { monthlyUsd: number; dailyPerUser: number }, store: UsageStore, model = 'claude-sonnet-5-5') {
  const parse = vi.fn(async () => ok);
  const calls: LlmCallRecord[] = [];
  const p = new AnthropicProvider({
    client: { messages: { parse } } as never,
    models: { draft: model, bulk: 'claude-haiku-5-5' },
    sink: { record: (c) => void calls.push(c) },
    limits, usage: store, now: () => 0,
  });
  return { p, parse, calls };
}

describe('spend cap and daily limit', () => {
  it('cap 0 means no calls and no model request', async () => {
    const { p, parse } = build({ monthlyUsd: 0, dailyPerUser: 20 }, fakeStore());
    expect(await p.extract(req)).toEqual({ status: 'unavailable', reason: 'spend_cap' });
    expect(parse).not.toHaveBeenCalled();
  });
  it('blocks once the month spend reaches the cap', async () => {
    const { p, parse } = build({ monthlyUsd: 5, dailyPerUser: 20 }, fakeStore({ monthSpendUsd: async () => 5 }));
    expect(await p.extract(req)).toEqual({ status: 'unavailable', reason: 'spend_cap' });
    expect(parse).not.toHaveBeenCalled();
  });
  it('allows below the cap', async () => {
    const { p } = build({ monthlyUsd: 5, dailyPerUser: 20 }, fakeStore({ monthSpendUsd: async () => 4.99 }));
    expect((await p.extract(req)).status).toBe('ok');
  });
  it('blocks a student at the daily limit but not another student', async () => {
    const store = fakeStore({ userCallsToday: async (u) => (u === 'u1' ? 20 : 0) });
    const { p, parse } = build({ monthlyUsd: 5, dailyPerUser: 20 }, store);
    expect(await p.extract({ ...req, userId: 'u1' })).toEqual({ status: 'unavailable', reason: 'daily_limit' });
    expect(parse).not.toHaveBeenCalled();
    expect((await p.extract({ ...req, userId: 'u2' })).status).toBe('ok');
  });
  it('daily limit 0 blocks every student', async () => {
    const { p } = build({ monthlyUsd: 5, dailyPerUser: 0 }, fakeStore());
    expect(await p.extract({ ...req, userId: 'u1' })).toEqual({ status: 'unavailable', reason: 'daily_limit' });
  });
  it('fails closed when the usage store errors', async () => {
    const { p, parse } = build({ monthlyUsd: 5, dailyPerUser: 20 }, fakeStore({ monthSpendUsd: async () => { throw new Error('db down'); } }));
    expect(await p.extract(req)).toEqual({ status: 'unavailable', reason: 'error' });
    expect(parse).not.toHaveBeenCalled();
  });
  it('logs model, tokens, estimated cost and user, and counts the call', async () => {
    const store = fakeStore();
    const { p, calls } = build({ monthlyUsd: 5, dailyPerUser: 20 }, store);
    await p.extract({ ...req, userId: 'u1', tier: 'draft' });
    expect(calls[0]).toMatchObject({ model: 'claude-sonnet-5-5', inputTokens: 1_000_000, userId: 'u1' });
    expect(calls[0]!.estCostUsd).toBeGreaterThan(0);
    expect(store.noted).toHaveLength(1);
  });
  it('bulk (haiku) is cheaper than draft (sonnet) for the same usage', async () => {
    const a = build({ monthlyUsd: 5, dailyPerUser: 20 }, fakeStore());
    const b = build({ monthlyUsd: 5, dailyPerUser: 20 }, fakeStore());
    await a.p.extract({ ...req, tier: 'draft' });
    await b.p.extract({ ...req, tier: 'bulk' });
    expect(b.calls[0]!.estCostUsd).toBeLessThan(a.calls[0]!.estCostUsd);
  });
});
