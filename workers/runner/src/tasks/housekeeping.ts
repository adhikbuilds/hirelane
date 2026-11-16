/**
 * `housekeeping:sweep`: retention for small auth and abuse-control tables that hold hashed identifiers (target_hmac, ip_hash)
 * and would otherwise be kept forever. Daily. Logs carry counts only.
 *   otp_challenges   expired, or consumed, more than 24 h ago (same rule as purgeExpiredChallenges)
 *   rate_limits      windows older than 2 days
 *   join_attempts    older than 30 days
 */
import type { Task, TaskList } from 'graphile-worker';
import { adminRun, type ResumeHelpers, type Run } from './resume-common';

const DAY = 86_400_000;

export async function runHousekeeping(run: Run, now: Date): Promise<{ otp: number; rateLimits: number; joinAttempts: number }> {
  return run(async (c) => {
    const otp = await c.query('DELETE FROM otp_challenges WHERE expires_at < $1 OR (consumed_at IS NOT NULL AND consumed_at < $1)', [new Date(now.getTime() - DAY)]);
    const rl = await c.query('DELETE FROM rate_limits WHERE window_start < $1', [new Date(now.getTime() - 2 * DAY)]);
    const ja = await c.query('DELETE FROM join_attempts WHERE at < $1', [new Date(now.getTime() - 30 * DAY)]);
    return { otp: otp.rowCount ?? 0, rateLimits: rl.rowCount ?? 0, joinAttempts: ja.rowCount ?? 0 };
  });
}

export function createHousekeepingTasks(over: { run?: Run; now?: () => Date } = {}): TaskList {
  const sweep: Task = async (_payload, helpers) => {
    const r = await runHousekeeping(over.run ?? adminRun, (over.now ?? (() => new Date()))());
    (helpers as unknown as ResumeHelpers).logger.info(`housekeeping:sweep otp ${r.otp} rate_limits ${r.rateLimits} join_attempts ${r.joinAttempts}`);
  };
  return { 'housekeeping:sweep': sweep };
}
