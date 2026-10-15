import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Metadata only. No prompt or completion content is ever stored. */
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    batchSize: integer('batch_size').notNull().default(1),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_calls_at_idx').on(t.at), index('llm_calls_purpose_at_idx').on(t.purpose, t.at)],
);
