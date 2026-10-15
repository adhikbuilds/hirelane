import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    domain: text('domain'),
    logoPath: text('logo_path'),
    logoSource: text('logo_source'),
    nameSource: text('name_source').notNull().default('config'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('companies_slug_uq').on(t.slug), unique('companies_domain_uq').on(t.domain)],
);

export const companyBoards = pgTable(
  'company_boards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    ats: text('ats').notNull(),
    token: text('token').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    verifiedAt: ts('verified_at'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastSuccessAt: ts('last_success_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('company_boards_ats_token_uq').on(t.ats, t.token),
    index('company_boards_company_idx').on(t.companyId),
  ],
);

export const postings = pgTable(
  'postings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => companyBoards.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    key: text('key').notNull(),
    url: text('url').notNull(),
    applyUrl: text('apply_url'),
    title: text('title').notNull(),
    locationRaw: text('location_raw'),
    raw: jsonb('raw').notNull(),
    contentHash: text('content_hash').notNull(),
    postedAt: ts('posted_at'),
    firstSeenAt: ts('first_seen_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
    missedRuns: smallint('missed_runs').notNull().default(0),
    closedAt: ts('closed_at'),
    jobId: uuid('job_id'),
    source: text('source').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('postings_board_external_uq').on(t.boardId, t.externalId),
    unique('postings_key_uq').on(t.key),
    index('postings_job_idx').on(t.jobId),
  ],
);

export const ingestRuns = pgTable(
  'ingest_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trigger: text('trigger').notNull(),
    mode: text('mode').notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    status: text('status').notNull().default('running'),
    boardsOk: integer('boards_ok').notNull().default(0),
    boardsFailed: integer('boards_failed').notNull().default(0),
    postingsNew: integer('postings_new').notNull().default(0),
    postingsChanged: integer('postings_changed').notNull().default(0),
    postingsClosed: integer('postings_closed').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('ingest_runs_started_idx').on(t.startedAt)],
);

export const ingestSourceRuns = pgTable(
  'ingest_source_runs',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => ingestRuns.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id')
      .notNull()
      .references(() => companyBoards.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    httpStatus: integer('http_status'),
    fetched: integer('fetched').notNull().default(0),
    new: integer('new').notNull().default(0),
    changed: integer('changed').notNull().default(0),
    unchanged: integer('unchanged').notNull().default(0),
    closed: integer('closed').notNull().default(0),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    errorText: text('error_text'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.boardId] }),
    index('ingest_source_runs_board_idx').on(t.boardId, t.runId),
  ],
);
