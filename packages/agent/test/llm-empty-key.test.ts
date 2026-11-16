import { describe, expect, it } from 'vitest';
import { createLlmProvider } from '../src/llm/factory.js';
import { NullProvider } from '../src/llm/null.js';

describe('createLlmProvider with an empty key', () => {
  it('never builds a client without a key', () => {
    let built = false;
    const p = createLlmProvider({ env: { HIRELANE_LLM: 'on', HIRELANE_LLM_MODE: 'anthropic', ANTHROPIC_API_KEY: '  ' }, makeClient: () => { built = true; return {} as never; } });
    expect(p).toBeInstanceOf(NullProvider);
    expect(built).toBe(false);
  });
});
