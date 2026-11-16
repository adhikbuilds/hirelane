type Env = Record<string, string | undefined>;

/** Thrown at startup for an invalid LLM setting. The message names the variable, never a secret value. */
export class LlmConfigError extends Error {
  constructor(readonly variable: string, message: string) {
    super(`${variable}: ${message}`);
    this.name = 'LlmConfigError';
  }
}

export const DRAFT_MODEL = 'claude-sonnet-5-5';
export const BULK_MODEL = 'claude-haiku-5-5';
/** The only model IDs this product may call. Anything else (including every Opus) is refused. */
export const ALLOWED_MODELS: readonly string[] = [DRAFT_MODEL, BULK_MODEL];

export function assertAllowedModel(variable: string, id: string): string {
  if (!ALLOWED_MODELS.includes(id)) {
    throw new LlmConfigError(variable, `model ${JSON.stringify(id.slice(0, 80))} is not allowed; use one of ${ALLOWED_MODELS.join(', ')}`);
  }
  return id;
}

/** HIRELANE_LLM=on enables calls. Default off; forced off when HIRELANE_DEMO=1. */
export function resolveLlmSwitch(env: Env = process.env): 'on' | 'off' {
  if ((env.HIRELANE_DEMO ?? '').trim() === '1') return 'off';
  return (env.HIRELANE_LLM ?? '').trim().toLowerCase() === 'on' ? 'on' : 'off';
}

export interface LlmLimits {
  /** Calls stop once this month's estimated spend reaches it. 0 = no calls. */
  monthlyUsd: number;
  /** Calls per student per UTC day. */
  dailyPerUser: number;
}

export function resolveLlmLimits(env: Env = process.env): LlmLimits {
  const rawM = (env.HIRELANE_LLM_MONTHLY_USD ?? '').trim();
  const rawD = (env.HIRELANE_LLM_DAILY_PER_USER ?? '').trim();
  let monthlyUsd = 0;
  if (rawM !== '') {
    monthlyUsd = Number(rawM);
    if (!Number.isFinite(monthlyUsd) || monthlyUsd < 0) {
      throw new LlmConfigError('HIRELANE_LLM_MONTHLY_USD', 'must be a number >= 0');
    }
  }
  let dailyPerUser = 20;
  if (rawD !== '') {
    dailyPerUser = Number(rawD);
    if (!Number.isInteger(dailyPerUser) || dailyPerUser < 0) {
      throw new LlmConfigError('HIRELANE_LLM_DAILY_PER_USER', 'must be an integer >= 0');
    }
  }
  return { monthlyUsd, dailyPerUser };
}

/** USD per million tokens. ESTIMATES for budgeting, not billing: check against the current price sheet. */
export const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  [DRAFT_MODEL]: { input: 3, output: 15 },
  [BULK_MODEL]: { input: 1, output: 5 },
};

export function estimateCostUsd(
  model: string,
  u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number },
): number {
  const p = PRICE_PER_MTOK[model];
  if (!p) return 0;
  const usd = (u.inputTokens * p.input + u.outputTokens * p.output
    + u.cacheReadTokens * p.input * 0.1 + u.cacheCreationTokens * p.input * 1.25) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** Counters the provider consults before each call. Implemented over Postgres in db-sink.ts. */
export interface UsageStore {
  monthSpendUsd(now: Date): Promise<number>;
  userCallsToday(userId: string, now: Date): Promise<number>;
  /** Called once per attempted model call, after it finishes. */
  noteCall(userId: string | undefined, now: Date): Promise<void>;
}
