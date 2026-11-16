"use server";

import { clearPendingCookie, pendingCookie, sessionCookie } from "@/lib/auth/cookies";
import { defaultEmailCodeDeps } from "@/lib/auth/deps";
import { verifyEmailCode } from "@/lib/auth/email-code";
import { PENDING_TTL_MS } from "@/lib/auth/pending-signup";
import { openAction, setCookie } from "@/lib/auth/request";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export type VerifyCodeActionResult =
  | { ok: false; reason: "bad_origin" | "invalid_code" }
  | { ok: false; reason: "rate_limited"; retryAfter: number };

/**
 * Checks the code. On success it never returns: it sets the cookie and redirects to /you (existing account) or
 * /welcome (new person, who must pass the 18+ gate first). Every wrong, expired or used code answers `invalid_code`.
 */
export async function verifyCode(input: { email: string; code: string }): Promise<VerifyCodeActionResult> {
  const req = await openAction();
  if (!req.ok) return req;
  const r = await verifyEmailCode(defaultEmailCodeDeps(), {
    email: String(input?.email ?? ""),
    code: String(input?.code ?? ""),
    ip: req.ip,
    previousToken: req.sessionToken,
    ua: req.ua,
  });
  if (r.kind === "rate_limited") return { ok: false, reason: "rate_limited", retryAfter: r.retryAfter };
  if (r.kind === "invalid") return { ok: false, reason: "invalid_code" };
  if (r.kind === "signed_in") {
    await setCookie(sessionCookie(r.session.token, SESSION_MAX_AGE_SECONDS));
    await setCookie(clearPendingCookie());
    redirect("/you");
  }
  await setCookie(pendingCookie(r.cookieValue, PENDING_TTL_MS / 1000));
  redirect("/welcome");
}
