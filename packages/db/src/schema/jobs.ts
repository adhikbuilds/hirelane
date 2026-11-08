import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgMaterializedView,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { companies, postings } from './ingest.js';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const skills = pgTable(
  'skills',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    aliases: text('aliases').array().notNull().default([]),
    category: text('category').notNull(),
    adjacent: text('adjacent').array().notNull().default([]),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
);

export const fxRates = pgTable(
  'fx_rates',
  {
    asOf: date('as_of').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    perUsd: numeric('per_usd', { precision: 18, scale: 8 }).notNull(),
    source: text('source').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.asOf, t.currency] })],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    titleNorm: text('title_norm').notNull(),
    roleFamily: text('role_family'),
    level: text('level'),
    workplace: text('workplace'),
    employment: text('employment'),
    remote: boolean('remote').notNull().default(false),
    remoteScope: text('remote_scope').notNull().default('none'),
    countries: char('countries', { length: 2 }).array().notNull().default([]),
    locations: jsonb('locations').notNull().default([]),
    visa: text('visa').notNull().default('unknown'),
    descriptionMd: text('description_md'),
    descriptionText: text('description_text'),
    docHash: text('doc_hash').notNull(),
    searchText: text('search_text').notNull().default(''),
    contentUpdatedAt: ts('content_updated_at').notNull().defaultNow(),
    salaryMinMinor: bigint('salary_min_minor', { mode: 'number' }),
    salaryMaxMinor: bigint('salary_max_minor', { mode: 'number' }),
    salaryCurrency: char('salary_currency', { length: 3 }),
    salaryPeriod: text('salary_period'),
    salaryAnnualUsdMin: bigint('salary_annual_usd_min', { mode: 'number' }),
    salaryAnnualUsdMax: bigint('salary_annual_usd_max', { mode: 'number' }),
    salaryAnnualInrMin: bigint('salary_annual_inr_min', { mode: 'number' }),
    salaryAnnualInrMax: bigint('salary_annual_inr_max', { mode: 'number' }),
    salarySource: text('salary_source'),
    salaryKind: text('salary_kind'),
    salaryCtc: boolean('salary_ctc'),
    salaryTrace: jsonb('salary_trace'),
    fxDate: date('fx_date'),
    salaryStated: boolean('salary_stated').notNull().default(false),
    skills: text('skills').array().notNull().default([]),
    simhash: bigint('simhash', { mode: 'bigint' }),
    tokenCount: integer('token_count').notNull().default(0),
    embedding: vector('embedding', { dimensions: 384 }),
    embeddingModel: text('embedding_model'),
    traces: jsonb('traces').notNull().default({}),
    llmEligibility: jsonb('llm_eligibility'),
    postedAt: ts('posted_at'),
    firstSeenAt: ts('first_seen_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
    closedAt: ts('closed_at'),
    enrichVersion: integer('enrich_version').notNull(),
    primaryPostingId: uuid('primary_posting_id').references(() => postings.id, { onDelete: 'set null' }),
    source: text('source').notNull(),
    /** Migration 0018: greenhouse | lever | ashby | jsonld | zoho_rss | campus_drive | user_shared. All three are set together or all NULL. */
    sourceKind: text('source_kind'),
    /** Human-readable origin, e.g. `careers.trelliscloud.in` or `Shared from Reddit`. */
    sourceLabel: text('source_label'),
    /** The original posting, https. For user_shared only the pasted URL; the page behind it is never fetched. */
    sourceUrl: text('source_url'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('jobs_slug_uq').on(t.slug),
    index('jobs_company_closed_idx').on(t.companyId, t.closedAt),
    index('jobs_cluster_idx').on(t.companyId, t.titleNorm),
  ],
);

export const jobRequirements = pgTable(
  'job_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    ord: integer('ord').notNull(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    category: text('category').notNull(),
    skillIds: text('skill_ids').array().notNull().default([]),
    yearsMin: integer('years_min'),
    spanStart: integer('span_start').notNull(),
    spanEnd: integer('span_end').notNull(),
    section: text('section'),
    extractor: text('extractor').notNull(),
    confidence: real('confidence').notNull(),
    ruleIds: text('rule_ids').array().notNull().default([]),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('job_requirements_job_ord_uq').on(t.jobId, t.ord)],
);

/** Counts per grain, refreshed by the `facets:refresh` task. Declared `.existing()`: migration 0005 owns the DDL. */
export const jobFacets = pgMaterializedView('job_facets', {
  k: text('k').notNull(),
  grain: text('grain').notNull(),
  roleFamily: text('role_family'),
  country: text('country'),
  remote: boolean('remote'),
  hasSalary: boolean('has_salary'),
  n: integer('n').notNull(),
}).existing();
