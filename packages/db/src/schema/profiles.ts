import { bigint, boolean, customType, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Trimmed (Amendment B section 13): no college_tier, cohort_code, grad_year or degree. */
export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  collegeTextEnc: bytea('college_text_enc'),
  roleFamilies: text('role_families').array().notNull().default([]),
  cities: text('cities').array().notNull().default([]),
  remoteOk: boolean('remote_ok').notNull().default(false),
  level: text('level'),
  floorMinor: bigint('floor_minor', { mode: 'number' }),
  floorCurrency: text('floor_currency'),
  tz: text('tz').notNull().default('Asia/Kolkata'),
  picksHour: smallint('picks_hour').notNull().default(9),
  pausedUntil: tstz('paused_until'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const workAuthorizations = pgTable(
  'work_authorizations',
  {
    userId: uuid('user_id').notNull(),
    country: text('country').notNull(),
    status: text('status').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.country] })],
);

/** answer_enc is a vault envelope. Never stored or logged in clear. */
export const answerBank = pgTable(
  'answer_bank',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    questionKey: text('question_key').notNull(),
    labelSeen: text('label_seen'),
    answerEnc: bytea('answer_enc').notNull(),
    sensitive: boolean('sensitive').notNull().default(false),
    source: text('source').notNull().default('user'),
    lastUsedAt: tstz('last_used_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('answer_bank_user_key_uq').on(t.userId, t.questionKey)],
);

/** parentId null = root. size/hmac/blob are null only on a builder draft (no PDF yet). The cap of 3 counts active roots. health holds check ids, statuses and offsets only. */
export const resumes = pgTable('resumes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  parentId: uuid('parent_id'),
  label: text('label'),
  source: text('source').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes'),
  fileHmac: text('file_hmac'),
  blobKey: text('blob_key'),
  pages: smallint('pages'),
  textLayer: text('text_layer'),
  producerFamily: text('producer_family'),
  parseStatus: text('parse_status').notNull().default('uploaded'),
  rejectCode: text('reject_code'),
  parsedEnc: bytea('parsed_enc'),
  parsedVersion: smallint('parsed_version').notNull().default(0),
  health: jsonb('health').notNull().default([]),
  healthPassed: smallint('health_passed').notNull().default(0),
  healthTotal: smallint('health_total').notNull().default(0),
  sensitiveKinds: text('sensitive_kinds').array().notNull().default([]),
  skills: text('skills').array().notNull().default([]),
  confirmedAt: tstz('confirmed_at'),
  isDefault: boolean('is_default').notNull().default(false),
  deletedAt: tstz('deleted_at'),
  purgeAfter: tstz('purge_after'),
  purgedAt: tstz('purged_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

/** Insert-only audit. resumeId becomes null when the resume row is removed. */
export const fileAccessLog = pgTable('file_access_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  resumeId: uuid('resume_id'),
  action: text('action').notNull(),
  ipHash: text('ip_hash'),
  at: tstz('at').notNull().defaultNow(),
});

/** Plain columns on purpose (matching and k >= 10 aggregates). Written only on confirm. No gap-reason column. */
export const eligibilityProfiles = pgTable('eligibility_profiles', {
  userId: uuid('user_id').primaryKey(),
  pct10: numeric('pct_10', { precision: 5, scale: 2, mode: 'number' }),
  board10: text('board_10'),
  secondaryKind: text('secondary_kind'),
  pctSecondary: numeric('pct_secondary', { precision: 5, scale: 2, mode: 'number' }),
  boardSecondary: text('board_secondary'),
  degree: text('degree'),
  branchCode: text('branch_code'),
  branchRaw: text('branch_raw'),
  gradScore: numeric('grad_score', { precision: 5, scale: 2, mode: 'number' }),
  gradScale: smallint('grad_scale'),
  gradPctEquiv: numeric('grad_pct_equiv', { precision: 5, scale: 2, mode: 'number' }),
  gradConversion: text('grad_conversion'),
  gradIsFinal: boolean('grad_is_final'),
  activeBacklogs: smallint('active_backlogs'),
  backlogHistory: smallint('backlog_history'),
  gapYears: smallint('gap_years'),
  passoutYear: smallint('passout_year'),
  lateralEntry: boolean('lateral_entry'),
  fieldMeta: jsonb('field_meta').notNull().default({}),
  sourceResumeId: uuid('source_resume_id'),
  confirmedAt: tstz('confirmed_at').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});
