import { hmac } from "@hirelane/vault";
import type { CreatedSession } from "@hirelane/db";
import { DEMO_PERSONAS, demoEmailAllowed, demoEnabled, isDemoPersona, type DemoPersona } from "../demo";
import { checkRateLimit, guardedLimit } from "../rate-limit";
import { startSession, type AuthDeps } from "./session";

/** Demo sign-ins per client IP per window. A visitor clicking both buttons a few times is fine; a script is not. */
export const DEMO_SIGNIN_IP_LIMIT = 10;
export const DEMO_SIGNIN_WINDOW_SECONDS = 600;
/** Demo sign-ins across all clients per window, so a script spread over many IPs is still capped. */
export const DEMO_SIGNIN_GLOBAL_LIMIT = 300;

export type DemoSessionResult =
  | { kind: "signed_in"; userId: string; session: CreatedSession }
  | { kind: "off" }
  | { kind: "not_seeded" }
  | { kind: "rate_limited"; retryAfter: number };

/**
 * A real session for one of the two seeded demo accounts, with no email code. Only when HIRELANE_DEMO=1, only for the
 * fixed synthetic addresses in DEMO_PERSONAS, and rate limited per IP. The visitor sees what the account sees under RLS,
 * which is the demo campus and nothing else.
 */
export async function startDemoSession(
  deps: AuthDeps,
  input: { persona: string; ip: string; previousToken?: string | null; ua?: string | null },
): Promise<DemoSessionResult> {
  if (!demoEnabled(deps.env ?? process.env) || !isDemoPersona(input.persona)) return { kind: "off" };
  const email = DEMO_PERSONAS[input.persona as DemoPersona].email;
  if (!demoEmailAllowed(email)) return { kind: "off" };

  const ipHash = await hmac(deps.keys, "auth/ip", input.ip);
  const rl = await guardedLimit(() => deps.db((c) => checkRateLimit(c, `demo-signin-ip:${ipHash}`, { limit: DEMO_SIGNIN_IP_LIMIT, windowSeconds: DEMO_SIGNIN_WINDOW_SECONDS, now: deps.now() })));
  if (!rl.allowed) return { kind: "rate_limited", retryAfter: rl.retryAfter };
  const gl = await guardedLimit(() => deps.db((c) => checkRateLimit(c, "demo-signin-global", { limit: DEMO_SIGNIN_GLOBAL_LIMIT, windowSeconds: DEMO_SIGNIN_WINDOW_SECONDS, now: deps.now() })));
  if (!gl.allowed) return { kind: "rate_limited", retryAfter: gl.retryAfter };

  const row = await deps.db((c) => c.query("SELECT id FROM users WHERE email = $1", [email]));
  const userId = row.rows[0]?.id as string | undefined;
  if (!userId) return { kind: "not_seeded" };
  const session = await startSession(deps, { userId, previousToken: input.previousToken, ua: input.ua });
  return { kind: "signed_in", userId, session };
}
