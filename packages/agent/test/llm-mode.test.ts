import { describe, expect, it } from 'vitest';
import { createLlmProvider, resolveLlmMode, resolveModels, NullProvider } from '../src/llm/index.js';

describe('resolveLlmMode', () => {
  it('defaults to off with no API key', () => {
    expect(resolveLlmMode({})).toBe('off');
  });
  it('defaults to anthropic when a key is present', () => {
    expect(resolveLlmMode({ ANTHROPIC_API_KEY: 'k' })).toBe('anthropic');
  });
  it('honours explicit off/fixture even with a key', () => {
    expect(resolveLlmMode({ HIRELANE_LLM_MODE: 'off', ANTHROPIC_API_KEY: 'k' })).toBe('off');
    expect(resolveLlmMode({ HIRELANE_LLM_MODE: 'fixture' })).toBe('fixture');
  });
  it('degrades anthropic to off without a key', () => {
    expect(resolveLlmMode({ HIRELANE_LLM_MODE: 'anthropic' })).toBe('off');
  });
  it('treats unknown values and empty key as off', () => {
    expect(resolveLlmMode({ HIRELANE_LLM_MODE: 'bogus', ANTHROPIC_API_KEY: 'k' })).toBe('off');
    expect(resolveLlmMode({ ANTHROPIC_API_KEY: '  ' })).toBe('off');
  });
  it('is case and whitespace tolerant', () => {
    expect(resolveLlmMode({ HIRELANE_LLM_MODE: ' Fixture ' })).toBe('fixture');
  });
});

describe('resolveModels', () => {
  it('defaults draft to claude-sonnet-5-5 and bulk to claude-haiku-5-5', () => {
    expect(resolveModels({})).toEqual({ draft: 'claude-sonnet-5-5', bulk: 'claude-haiku-5-5' });
  });
  it('reads overrides', () => {
    expect(resolveModels({ HIRELANE_MODEL_BULK: 'claude-sonnet-5-5', HIRELANE_MODEL_DRAFT: 'claude-haiku-5-5' })).toEqual({ draft: 'claude-haiku-5-5', bulk: 'claude-sonnet-5-5' });
  });
});

describe('createLlmProvider', () => {
  it('returns the Null provider when off', () => {
    const p = createLlmProvider({ env: {} });
    expect(p).toBeInstanceOf(NullProvider);
    expect(p.mode).toBe('off');
  });
  it('fixture mode without fixtures yields unavailable results', async () => {
    const p = createLlmProvider({ env: { HIRELANE_LLM_MODE: 'fixture' } });
    expect(p.mode).toBe('fixture');
  });
});
