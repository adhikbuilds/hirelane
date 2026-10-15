import { quickAddJob, type TaskSpec } from 'graphile-worker';

/**
 * Thin wrapper over graphile-worker's quickAddJob so web code never imports the worker package
 * tree. `jobKey` gives dedup/replacement; the connection defaults to DATABASE_URL.
 */
export async function addJob(
  identifier: string,
  payload: unknown = {},
  spec: TaskSpec = {},
  connectionString: string = process.env['DATABASE_URL'] ?? '',
) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set; cannot enqueue a job.');
  }
  return quickAddJob({ connectionString }, identifier, payload, spec);
}
