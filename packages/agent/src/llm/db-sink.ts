import { llmCalls } from '@hirelane/db';
import type { UsageStore } from './config.js';
import type { LlmCallRecord, LlmCallSink } from './types.js';

type Insertable = { insert(table: typeof llmCalls): { values(v: typeof llmCalls.$inferInsert): PromiseLike<unknown> } };

/** Persist call metadata to llm_calls. Takes any Drizzle db handle. Never receives content. */
export function createDbCallSink(db: Insertable): LlmCallSink {
  return {
    async record(c: LlmCallRecord) {
      await db.insert(llmCalls).values({
        purpose: c.purpose, model: c.model, mode: c.mode, status: c.status,
        inputTokens: c.inputTokens, outputTokens: c.outputTokens,
        cacheReadTokens: c.cacheReadTokens, cacheCreationTokens: c.cacheCreationTokens,
        latencyMs: c.latencyMs, batchSize: c.batchSize,
        estCostUsd: c.estCostUsd.toFixed(6), userId: c.userId ?? null,
      });
    },
  };
}

/** Anything with pg's query(text, params) shape: a Pool or Client. */
export interface Queryable {
  query(text: string, params: unknown[]): Promise<{ rows: any[] }>;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Spend from llm_calls.est_cost_usd (UTC month); per-student counts from llm_user_daily. Server-side, privileged connection. */
export function createDbUsageStore(db: Queryable): UsageStore {
  return {
    async monthSpendUsd(now) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const { rows } = await db.query(
        'SELECT COALESCE(SUM(est_cost_usd), 0) AS usd FROM llm_calls WHERE at >= $1 AND at < $2',
        [start.toISOString(), end.toISOString()],
      );
      return Number(rows[0]?.usd ?? 0);
    },
    async userCallsToday(userId, now) {
      const { rows } = await db.query('SELECT calls FROM llm_user_daily WHERE user_id = $1 AND day = $2', [userId, utcDay(now)]);
      return Number(rows[0]?.calls ?? 0);
    },
    async noteCall(userId, now) {
      if (userId === undefined) return;
      await db.query(
        `INSERT INTO llm_user_daily (user_id, day, calls) VALUES ($1, $2, 1)
         ON CONFLICT (user_id, day) DO UPDATE SET calls = llm_user_daily.calls + 1`,
        [userId, utcDay(now)],
      );
    },
  };
}
