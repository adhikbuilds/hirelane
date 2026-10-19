import { pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Early-access sign-ups. Uniqueness is lower(email), enforced by a SQL unique index in 0006. */
export const waitlist = pgTable('waitlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  gradYear: smallint('grad_year'),
  source: text('source').notNull().default('landing'),
  consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
