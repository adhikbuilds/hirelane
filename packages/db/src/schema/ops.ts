import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const workerHeartbeats = pgTable(
  'worker_heartbeats',
  {
    workerId: text('worker_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('worker_heartbeats_at_idx').on(t.at)],
);

/** Uniqueness is (key, coalesce(user_id, nil uuid)), enforced by a SQL unique index in 0001. */
export const featureFlags = pgTable('feature_flags', {
  key: text('key').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  userId: uuid('user_id'),
});

export const rateLimits = pgTable(
  'rate_limits',
  {
    bucket: text('bucket').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.windowStart] })],
);
