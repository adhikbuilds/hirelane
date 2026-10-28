import { timingSafeEqual } from "node:crypto";
import {
  ABSOLUTE_TTL_MS,
  createSession,
  deleteAccount,
  lookupSession,
  revokeSession,
  rotateSession,
  withAuth,
  withUser,
  type CreatedSession,
  type DeleteAccountResult,
  type LiveSession,
  type Queryable,
  type SessionClient,
} from "@hirelane/db";
import { EnvKeyProvider, hmac, type KeyProvider } from "@hirelane/vault";
import { z } from "zod";
import { readCookie, sessionCookieName } from "./cookies";

/**
 * Everything here runs as the narrow hirelane_auth role through withAuth, never as the table owner: session, OTP and
 * identity rows are revoked from the app role, and no user context exists yet when they are read.
 */
export interface AuthDeps {
  /** Runs `fn` on one connection with the hirelane_auth role. */
  db: <T>(fn: (c: Queryable) => Promise<T>) => Promise<T>;
  keys: KeyProvider;
  now: () => Date;
  env?: Record<string, string | undefined>;
}

let sharedKeys: KeyProvider | undefined;
export function defaultKeys(): KeyProvider {
  return (sharedKeys ??= new EnvKeyProvider());
}

export function defaultAuthDeps(): AuthDeps {
  return { db: (fn) => withAuth((c) => fn(c)), keys: defaultKeys(), now: () => new Date() };
}

// ---------- signed payloads (pending signup, OIDC state) ----------

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** `base64url(json).hmac-hex`, keyed by a vault subkey per purpose. Integrity only; do not put secrets in it. */
export async function signPayload(keys: KeyProvider, purpose: string, payload: unknown): Promise<string> {
  const body = b64(JSON.stringify(payload));
  return `${body}.${await hmac(keys, `auth/sign/${purpose}`, body)}`;
}

export async function verifyPayload(keys: KeyProvider, purpose: string, value: string | null | undefined): Promise<unknown | null> {
  if (!value || value.length > 4096) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(await hmac(keys, `auth/sign/${purpose}`, parts[0]), "utf8");
  const given = Buffer.from(parts[1], "utf8");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// ---------- identity inputs ----------

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Trimmed, lower-cased address, or null when it is not a plain email. */
export function normalizeEmail(raw: unknown): string | null {
  const r = emailSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Keyed hash of an address: the subject of an email_otp identity and the OTP lookup key. Never reversible. */
export const emailHmac = (keys: KeyProvider, email: string): Promise<string> => hmac(keys, "auth/email-target", email);

export const uaHash = async (keys: KeyProvider, ua: string | null | undefined): Promise<string | null> =>
  ua ? hmac(keys, "auth/ua", ua.slice(0, 300)) : null;

// ---------- sessions ----------

export type { CreatedSession, LiveSession };
export const SESSION_MAX_AGE_SECONDS = Math.floor(ABSOLUTE_TTL_MS / 1000);

/** Login: mint a fresh token and retire the one that arrived with the request. */
export async function startSession(
  deps: AuthDeps,
  input: { userId: string; client?: SessionClient; previousToken?: string | null; ua?: string | null },
): Promise<CreatedSession> {
  const ua = await uaHash(deps.keys, input.ua);
  return deps.db((c) => rotateSession(c, input.previousToken, { userId: input.userId, client: input.client ?? "web", uaHash: ua, now: deps.now() }));
}

export const sessionFromToken = (deps: AuthDeps, token: string | null | undefined): Promise<LiveSession | null> =>
  token ? deps.db((c) => lookupSession(c, token, deps.now())) : Promise.resolve(null);

/** Logout. The row is marked revoked, so the cookie is dead even if the browser keeps sending it. */
export const endSession = (deps: AuthDeps, token: string | null | undefined): Promise<boolean> =>
  token ? deps.db((c) => revokeSession(c, token, deps.now())) : Promise.resolve(false);

/**
 * Session token from a request: the web cookie, or `Authorization: Bearer hl_at_...` for the future Android client.
 * The Bearer path is designed here and used later; the same sessions table backs both.
 */
export function tokenFromRequest(headers: { get: (name: string) => string | null }, env: Record<string, string | undefined> = process.env): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const m = /^Bearer (hl_at_[A-Za-z0-9_-]{20,100})$/.exec(auth);
    return m ? m[1]! : null;
  }
  // A cookie only ever carries a web token; an android token in a cookie is refused.
  const fromCookie = readCookie(headers.get("cookie"), sessionCookieName(env));
  return fromCookie && fromCookie.startsWith("hl_s_") ? fromCookie : null;
}

// ---------- identities ----------

export type Provider = "google" | "email_otp" | "phone_otp";

/**
 * Finds the account for a verified identity, linking by verified email when only the address matches.
 * Returns null when nobody has this identity yet: the caller then starts the 18+ gate instead of creating a row.
 */
export async function resolveIdentity(
  c: Queryable,
  input: { provider: Provider; subject: string; email: string; emailVerified: boolean },
): Promise<string | null> {
  const byIdentity = await c.query("SELECT user_id FROM auth_identities WHERE provider = $1 AND subject = $2", [input.provider, input.subject]);
  if (byIdentity.rows[0]) return byIdentity.rows[0].user_id as string;
  if (!input.emailVerified) return null;
  const byEmail = await c.query("SELECT id FROM users WHERE email = $1", [input.email]);
  const userId = byEmail.rows[0]?.id as string | undefined;
  if (!userId) return null;
  await c.query(
    `INSERT INTO auth_identities (user_id, provider, subject) VALUES ($1, $2, $3) ON CONFLICT (provider, subject) DO NOTHING`,
    [userId, input.provider, input.subject],
  );
  await c.query("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1", [userId]);
  return userId;
}

// ---------- delete ----------

export const deleteAccountFor = (deps: AuthDeps, userId: string): Promise<DeleteAccountResult> =>
  deps.db((c) => deleteAccount(c, userId, deps.now()));

// ---------- consent after sign-up ----------

/** Kinds a signed-in person may record themselves. age_18_plus is written once, at sign-up, and never here. */
export const SELF_CONSENT_KINDS = ["terms", "privacy", "campus_share", "offer_letter_tpo", "llm_resume", "llm_contacts", "whatsapp", "email_picks", "analytics"] as const;
export type SelfConsentKind = (typeof SELF_CONSENT_KINDS)[number];

export const LEGAL_DOC_VERSION = "2026-10-29";

/** Append-only: a withdrawal is a new row with granted=false. Runs as hirelane_app, so RLS applies. */
export async function recordConsent(userId: string, kind: SelfConsentKind, granted: boolean): Promise<void> {
  if (!(SELF_CONSENT_KINDS as readonly string[]).includes(kind)) throw new Error("unknown consent kind");
  await withUser(userId, (c) =>
    c.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, $2, $3, $4)", [userId, kind, granted, LEGAL_DOC_VERSION]),
  );
}
