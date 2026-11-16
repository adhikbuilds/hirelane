export { close, getDb, getPool, runAsRole, withAdmin, withAuth, withUser } from './client.js';
export { applyMigrations, type MigrationResult } from './migrator.js';
export { addJob } from './queue.js';
export { findSchemaDrift } from './verify-schema-lib.js';
export * from './schema/index.js';
export * from './ingest/index.js';
export * from './enrich/index.js';
export * from './auth/index.js';
