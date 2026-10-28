"use server";

import { clearSessionCookie } from "@/lib/auth/cookies";
import { currentSession, openAction, setCookie } from "@/lib/auth/request";
import { defaultAuthDeps, deleteAccountFor, endSession, recordConsent, SELF_CONSENT_KINDS, type SelfConsentKind } from "@/lib/auth/session";
import { redirect } from "next/navigation";

type Refusal = { ok: false; reason: "bad_origin" | "signed_out" };

/** Logout revokes the session row on the server, then clears the cookie. */
export async function logout(): Promise<Refusal> {
  const req = await openAction();
  if (!req.ok) return req;
  await endSession(defaultAuthDeps(), req.sessionToken);
  await setCookie(clearSessionCookie());
  redirect("/signin");
}

/** Revokes every session, then hard-deletes the account (cascade). Needs `confirm: true`. */
export async function deleteMyAccount(input: { confirm: boolean }): Promise<Refusal | { ok: false; reason: "not_confirmed" }> {
  const req = await openAction();
  if (!req.ok) return req;
  const me = await currentSession(req);
  if (!me) return { ok: false, reason: "signed_out" };
  if (input?.confirm !== true) return { ok: false, reason: "not_confirmed" };
  await deleteAccountFor(defaultAuthDeps(), me.userId);
  await setCookie(clearSessionCookie());
  redirect("/");
}

/** Records a consent choice (append-only; a withdrawal is a new row). age_18_plus can't be recorded here. */
export async function setConsent(input: { kind: SelfConsentKind; granted: boolean }): Promise<{ ok: true } | Refusal | { ok: false; reason: "unknown_kind" }> {
  const req = await openAction();
  if (!req.ok) return req;
  const me = await currentSession(req);
  if (!me) return { ok: false, reason: "signed_out" };
  if (!(SELF_CONSENT_KINDS as readonly string[]).includes(input?.kind)) return { ok: false, reason: "unknown_kind" };
  await recordConsent(me.userId, input.kind, input.granted === true);
  return { ok: true };
}
