"use server";

import { defaultEmailCodeDeps } from "@/lib/auth/deps";
import { requestEmailCode, type RequestCodeResult } from "@/lib/auth/email-code";
import { openAction } from "@/lib/auth/request";

export type SendEmailCodeResult = RequestCodeResult | { ok: false; reason: "bad_origin" };

/**
 * Sends a 6-digit code. The answer is identical for known and unknown addresses; the only differences are the
 * address not being an email and the caller's own rate limit.
 */
export async function sendEmailCode(input: { email: string }): Promise<SendEmailCodeResult> {
  const req = await openAction();
  if (!req.ok) return req;
  return requestEmailCode(defaultEmailCodeDeps(), { email: String(input?.email ?? ""), ip: req.ip });
}
