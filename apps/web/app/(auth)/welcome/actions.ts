"use server";

import { clearPendingCookie, sessionCookie } from "@/lib/auth/cookies";
import { completeSignup, readPendingSignup } from "@/lib/auth/pending-signup";
import { openAction, openRead, setCookie } from "@/lib/auth/request";
import { defaultAuthDeps, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export type AcceptSignupResult =
  | { ok: false; reason: "bad_origin" | "consent_required" | "under_18" | "expired" };

/**
 * The 18+ gate. "I am 18 or older" plus the terms and privacy boxes create the account (one transaction, three
 * consents). Anything less stores nothing. Under 18 clears the pending cookie. Success redirects to /you.
 */
export async function acceptSignup(input: { over18: boolean; terms: boolean; privacy: boolean }): Promise<AcceptSignupResult> {
  const req = await openAction();
  if (!req.ok) return req;
  const r = await completeSignup(
    defaultAuthDeps(),
    req.pendingValue,
    { over18: input?.over18 === true, terms: input?.terms === true, privacy: input?.privacy === true },
    { previousToken: req.sessionToken, ua: req.ua },
  );
  if (!r.ok) {
    if (r.reason !== "consent_required") await setCookie(clearPendingCookie());
    return { ok: false, reason: r.reason };
  }
  await setCookie(sessionCookie(r.session.token, SESSION_MAX_AGE_SECONDS));
  await setCookie(clearPendingCookie());
  redirect("/you");
}

/** "I am under 18" or "cancel": drop the pending cookie. Nothing was ever stored. */
export async function declineSignup(): Promise<{ ok: true } | { ok: false; reason: "bad_origin" }> {
  const req = await openAction();
  if (!req.ok) return req;
  await setCookie(clearPendingCookie());
  return { ok: true };
}

/** What /welcome shows: the address being signed up, or null when there is nothing pending (or it expired). */
export async function getPendingSignup(): Promise<{ email: string; provider: "google" | "linkedin" | "email_otp" } | null> {
  const req = await openRead(); // a render-time read: a navigation GET carries no Origin header
  const deps = defaultAuthDeps();
  const p = await readPendingSignup(deps.keys, req.pendingValue, deps.now());
  return p ? { email: p.email, provider: p.provider } : null;
}
