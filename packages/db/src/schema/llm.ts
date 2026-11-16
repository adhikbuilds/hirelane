import { date, index, integer, numeric, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';

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
    estCostUsd: numeric('est_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_calls_at_idx').on(t.at), index('llm_calls_purpose_at_idx').on(t.purpose, t.at), index('llm_calls_user_at_idx').on(t.userId, t.at)],
);

/** Model calls per student per UTC day. Server-only. */
export const llmUserDaily = pgTable(
  'llm_user_daily',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    calls: integer('calls').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);
