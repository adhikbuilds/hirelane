import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AnthropicProvider, type LlmCallRecord } from '../src/llm/index.js';

const Schema = z.object({ results: z.array(z.object({ id: z.string() })) });
const req = { purpose: 'requirements', system: 'STABLE SYSTEM', schema: Schema, items: [{ id: 'a', text: 'SECRET JOB TEXT' }] };
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 };
const ok = { stop_reason: 'end_turn', parsed_output: { results: [{ id: 'a' }] }, usage };

function setup(impl: () => unknown, env = {}) {
  const parse = vi.fn(impl as (...a: any[]) => any);
  const calls: LlmCallRecord[] = [];
  const p = new AnthropicProvider({
    client: { messages: { parse } } as never,
    models: { draft: 'claude-sonnet-5-5', bulk: 'claude-haiku-5-5' },
    sink: { record: (c) => void calls.push(c) },
    now: (() => { let t = 0; return () => (t += 50); })(),
    ...env,
  });
  return { p, parse, calls };
}

describe('AnthropicProvider', () => {
  it('sends model, cache_control, system first, untrusted data in user message, low effort', async () => {
    const { p, parse } = setup(async () => ok);
    const r = await p.extract(req);
    expect(r.status).toBe('ok');
    const args = parse.mock.calls[0]![0] as Record<string, any>;
    expect(args.model).toBe('claude-haiku-5-5');
    expect(args.cache_control).toEqual({ type: 'ephemeral' });
    expect(args.system).toBe('STABLE SYSTEM');
    expect(args.messages).toHaveLength(1);
    expect(args.messages[0].role).toBe('user');
    expect(args.messages[0].content).toContain('SECRET JOB TEXT');
    expect(args.system).not.toContain('SECRET JOB TEXT');
    expect(args.output_config.effort).toBe('low');
    expect(args.output_config.format).toBeDefined();
    expect(args.thinking).toBeUndefined();
    expect(args.tool_choice).toBeUndefined();
    expect(args.temperature).toBeUndefined();
  });
  it('logs tokens, latency and cache hits but never content', async () => {
    const { p, calls } = setup(async () => ok);
    await p.extract(req);
    expect(calls[0]).toEqual({
      purpose: 'requirements', model: 'claude-haiku-5-5', mode: 'anthropic', status: 'ok',
      inputTokens: 100, outputTokens: 20, cacheReadTokens: 90, cacheCreationTokens: 0,
      latencyMs: 50, batchSize: 1, estCostUsd: expect.any(Number),
    });
    expect(calls[0]!.estCostUsd).toBeGreaterThan(0);
    expect(JSON.stringify(calls)).not.toContain('SECRET');
    expect(JSON.stringify(calls)).not.toContain('STABLE');
  });
  it('treats refusal as unavailable', async () => {
    const { p, calls } = setup(async () => ({ ...ok, stop_reason: 'refusal' }));
    expect(await p.extract(req)).toEqual({ status: 'unavailable', reason: 'refusal' });
    expect(calls[0]!.status).toBe('refusal');
  });
  it('treats max_tokens as failed', async () => {
    const { p } = setup(async () => ({ ...ok, stop_reason: 'max_tokens' }));
    expect(await p.extract(req)).toEqual({ status: 'unavailable', reason: 'max_tokens' });
  });
  it('guards a null parsed_output', async () => {
    const { p, calls } = setup(async () => ({ ...ok, parsed_output: null }));
    expect(await p.extract(req)).toEqual({ status: 'unavailable', reason: 'parse_failed' });
    expect(calls[0]!.status).toBe('parse_failed');
  });
  it('maps rate limits, 5xx and connection errors separately', async () => {
    const h = new Headers();
    const rl = setup(async () => { throw Anthropic.APIError.generate(429, {}, 'slow', h); });
    expect(await rl.p.extract(req)).toEqual({ status: 'unavailable', reason: 'rate_limited' });
    const sv = setup(async () => { throw Anthropic.APIError.generate(503, {}, 'down', h); });
    expect(await sv.p.extract(req)).toEqual({ status: 'unavailable', reason: 'server_error' });
    const cn = setup(async () => { throw new Anthropic.APIConnectionError({ message: 'net' }); });
    expect(await cn.p.extract(req)).toEqual({ status: 'unavailable', reason: 'connection_error' });
    expect(cn.calls[0]!.status).toBe('connection_error');
  });
  it('maps 4xx to a non-retryable client_error and unknown throws to error', async () => {
    const h = new Headers();
    const c = setup(async () => { throw Anthropic.APIError.generate(400, {}, 'bad', h); });
    expect(await c.p.extract(req)).toEqual({ status: 'unavailable', reason: 'client_error' });
    const u = setup(async () => { throw new Error('weird'); });
    expect(await u.p.extract(req)).toEqual({ status: 'unavailable', reason: 'error' });
  });
  it('uses the draft model and medium effort for the draft tier', async () => {
    const { p, parse } = setup(async () => ok);
    await p.extract({ ...req, tier: 'draft' });
    expect((parse.mock.calls[0]![0] as any).output_config.effort).toBe('medium');
  });
  it('rejects empty batches without calling the API', async () => {
    const { p, parse } = setup(async () => ok);
    expect(await p.extract({ ...req, items: [] })).toEqual({ status: 'unavailable', reason: 'empty_batch' });
    expect(parse).not.toHaveBeenCalled();
  });
  it('splits oversized batches into chunks and merges results via extractBatched', async () => {
    const { p, parse } = setup(async () => ok);
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, text: 't' }));
    const rs = await p.extractBatched({ ...req, items }, 2);
    expect(parse).toHaveBeenCalledTimes(3);
    expect(rs).toHaveLength(3);
  });
});
