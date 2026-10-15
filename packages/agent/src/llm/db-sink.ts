import { llmCalls } from '@hirelane/db';
import type { LlmCallRecord, LlmCallSink } from './types.js';

type Insertable = { insert(table: typeof llmCalls): { values(v: typeof llmCalls.$inferInsert): PromiseLike<unknown> } };

/** Persist call metadata to llm_calls. Takes any Drizzle db handle. Never receives content. */
export function createDbCallSink(db: Insertable): LlmCallSink {
  return {
    async record(c: LlmCallRecord) {
      await db.insert(llmCalls).values({
        purpose: c.purpose, model: c.model, mode: c.mode, status: c.status,
        inputTokens: c.inputTokens, outputTokens: c.outputTokens,
        cacheReadTokens: c.cacheReadTokens, cacheCreationTokens: c.cacheCreationTokens,
        latencyMs: c.latencyMs, batchSize: c.batchSize,
      });
    },
  };
}
