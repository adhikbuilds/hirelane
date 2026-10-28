import { issueChallenge, verifyChallenge, type CreatedSession } from "@hirelane/db";
import { hmac } from "@hirelane/vault";
import { randomInt, randomUUID } from "node:crypto";
import { checkRateLimit, guardedLimit, scaledLimit } from "../rate-limit";
import { createPendingSignup } from "./pending-signup";
import { emailHmac, normalizeEmail, resolveIdentity, startSession, type AuthDeps } from "./session";

/**
 * Email 6-digit code (R1 fallback that works inside in-app browsers).
 *
 * Enumeration safety: requesting a code answers the same bytes for a known address, an unknown address and an
 * address that has hit its own limit. A code is mailed to every valid address, because a new address signs up through
 * the same flow. Wrong, expired, used, locked-out and unknown all give one `invalid` answer.
 */
export interface EmailCodeDeps extends AuthDeps {
  /** Delivers the code (file outbox in dev). Failures are swallowed so the response cannot reveal them. */
  sendCode: (to: string, code: string, purpose: "login") => Promise<void>;
  generateCode?: () => string;
}

export const SEND_IP_LIMIT = 10;
export const SEND_TARGET_LIMIT = 5;
export const VERIFY_IP_LIMIT = 30;
export const LIMIT_WINDOW_SECONDS = 600;
/** One mail per address per minute, ten per day, from any source. Silent: the answer never changes. */
export const RESEND_COOLDOWN_SECONDS = 60;
export const SEND_TARGET_DAILY_LIMIT = 10;
/** Verify attempts per address per hour, across all challenges. Past it the address is locked out until the window rolls. */
export const VERIFY_TARGET_HOURLY_LIMIT = 10;

export type RequestCodeResult =
  | { ok: true }
  | { ok: false; reason: "invalid_email" }
  | { ok: false; reason: "rate_limited" | "unavailable"; retryAfter: number };

const sixDigits = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");
const codeHash = (deps: AuthDeps, code: string) => (challengeId: string) => hmac(deps.keys, "auth/otp-code", `${challengeId}:${code}`);

/** Buckets are keyed by an HMAC of the IP and by the target HMAC, so neither raw addresses nor raw IPs reach rate_limits. */
function limit(deps: AuthDeps, bucket: string, max: number, windowSeconds = LIMIT_WINDOW_SECONDS) {
  return guardedLimit(() => deps.db((c) => checkRateLimit(c, bucket, { limit: max, windowSeconds, now: deps.now(), prune: Math.random() < 0.05, pruneAfterSeconds: 25 * 3600 })));
}

export async function requestEmailCode(deps: EmailCodeDeps, input: { email: string; ip: string }): Promise<RequestCodeResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "invalid_email" };

  const ipHash = await hmac(deps.keys, "auth/ip", input.ip);
  const ip = await limit(deps, `otp-send-ip:${ipHash}`, scaledLimit(input.ip, SEND_IP_LIMIT));
  if (ip.busy) return { ok: false, reason: "unavailable", retryAfter: ip.retryAfter };
  if (!ip.allowed) return { ok: false, reason: "rate_limited", retryAfter: ip.retryAfter };

  const target = await emailHmac(deps.keys, email);
  const perTarget = await limit(deps, `otp-target:${target}`, SEND_TARGET_LIMIT);
  // Over its own limit: answer exactly as if a code went out, send nothing. Existence plays no part in this branch.
  if (!perTarget.allowed) return { ok: true };
  // Resend cooldown and daily cap, per address, from any IP. Also silent, so a mail-bomber learns nothing and the
  // victim's inbox gets at most one a minute and ten a day.
  const cooldown = await limit(deps, `otp-cooldown:${target}`, 1, RESEND_COOLDOWN_SECONDS);
  if (!cooldown.allowed) return { ok: true };
  const daily = await limit(deps, `otp-day:${target}`, SEND_TARGET_DAILY_LIMIT, 86_400);
  if (!daily.allowed) return { ok: true };

  const code = (deps.generateCode ?? sixDigits)();
  const id = randomUUID();
  await deps.db(async (c) =>
    issueChallenge(c, { id, channel: "email", purpose: "login", targetHmac: target, codeHash: await codeHash(deps, code)(id), ipHash, now: deps.now() }),
  );
  try {
    await deps.sendCode(email, code, "login");
  } catch (e) {
    // Name only. The address and the code never go to a log.
    console.error(`auth: code delivery failed (${e instanceof Error ? e.name : "error"})`);
  }
  return { ok: true };
}

export type VerifyCodeResult =
  | { kind: "signed_in"; userId: string; session: CreatedSession }
  | { kind: "pending"; cookieValue: string }
  | { kind: "invalid" }
  | { kind: "rate_limited"; retryAfter: number };

export async function verifyEmailCode(
  deps: EmailCodeDeps,
  input: { email: string; code: string; ip: string; previousToken?: string | null; ua?: string | null },
): Promise<VerifyCodeResult> {
  const ip = await limit(deps, `otp-verify-ip:${await hmac(deps.keys, "auth/ip", input.ip)}`, scaledLimit(input.ip, VERIFY_IP_LIMIT));
  if (!ip.allowed) return { kind: "rate_limited", retryAfter: ip.retryAfter };

  const email = normalizeEmail(input.email);
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) return { kind: "invalid" };

  const target = await emailHmac(deps.keys, email);
  // Per-address attempt budget across challenges: asking for a fresh code no longer resets the guess counter.
  const perTarget = await limit(deps, `otp-verify-target:${target}`, VERIFY_TARGET_HOURLY_LIMIT, 3600);
  if (!perTarget.allowed) return { kind: "rate_limited", retryAfter: perTarget.retryAfter };
  const res = await deps.db((c) => verifyChallenge(c, { targetHmac: target, purpose: "login", hashFor: codeHash(deps, code), now: deps.now() }));
  if (!res.ok) return { kind: "invalid" };

  // The mailbox is proven. Existing account (by this identity or by the same address): sign in. Otherwise the 18+ gate.
  const userId = await deps.db((c) => resolveIdentity(c, { provider: "email_otp", subject: target, email, emailVerified: true }));
  if (userId) {
    const session = await startSession(deps, { userId, previousToken: input.previousToken, ua: input.ua });
    return { kind: "signed_in", userId, session };
  }
  return { kind: "pending", cookieValue: await createPendingSignup(deps.keys, { provider: "email_otp", subject: target, email }, deps.now()) };
}
