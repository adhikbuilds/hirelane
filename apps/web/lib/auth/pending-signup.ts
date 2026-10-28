import type { CreatedSession, Queryable } from "@hirelane/db";
import type { KeyProvider } from "@hirelane/vault";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { LEGAL_DOC_VERSION, resolveIdentity, signPayload, startSession, verifyPayload, type AuthDeps, type Provider } from "./session";

/**
 * The 18+ gate (DPDP s.9). A verified identity is parked in a signed 15-minute cookie. No users or auth_identities row
 * exists until the person attests "I am 18 or older" and accepts the terms and privacy notice; then the user, the
 * identity and the age_18_plus, terms and privacy consents are written in one transaction. No date of birth is asked.
 */
export const PENDING_TTL_MS = 15 * 60 * 1000;
const PURPOSE = "auth/pending-signup";

const pendingSchema = z.object({
  v: z.literal(1),
  provider: z.enum(["google", "email_otp"]),
  subject: z.string().min(1).max(256),
  email: z.string().min(3).max(254),
  iat: z.number(),
  exp: z.number(),
});
export type PendingSignup = z.infer<typeof pendingSchema>;

export async function createPendingSignup(
  keys: KeyProvider,
  who: { provider: "google" | "email_otp"; subject: string; email: string },
  now: Date,
): Promise<string> {
  return signPayload(keys, PURPOSE, { v: 1, ...who, iat: now.getTime(), exp: now.getTime() + PENDING_TTL_MS });
}

export async function readPendingSignup(keys: KeyProvider, value: string | null | undefined, now: Date): Promise<PendingSignup | null> {
  const raw = await verifyPayload(keys, PURPOSE, value);
  const parsed = pendingSchema.safeParse(raw);
  if (!parsed.success) return null;
  const t = now.getTime();
  // Not before it was issued (minus a minute of skew), and not after it expires.
  if (t >= parsed.data.exp || t < parsed.data.iat - 60_000) return null;
  return parsed.data;
}

export interface Attestation {
  over18: boolean;
  terms: boolean;
  privacy: boolean;
}

export type SignupResult =
  | { ok: true; userId: string; session: CreatedSession }
  | { ok: false; reason: "under_18" | "consent_required" | "expired" };

export async function completeSignup(
  deps: AuthDeps,
  pendingValue: string | null | undefined,
  attestation: Attestation,
  ctx: { previousToken?: string | null; ua?: string | null },
): Promise<SignupResult> {
  const pending = await readPendingSignup(deps.keys, pendingValue, deps.now());
  if (!pending) return { ok: false, reason: "expired" };
  // Under 18 (or no attestation): store nothing at all. The caller clears the cookie.
  if (attestation.over18 !== true) return { ok: false, reason: "under_18" };
  if (attestation.terms !== true || attestation.privacy !== true) return { ok: false, reason: "consent_required" };

  const now = deps.now();
  // Single use: the cookie is only good while this identity has no account. After sign-up it is a dead token, so a
  // captured copy cannot be replayed into a fresh session. (Two simultaneous accepts: one wins, the other expires.)
  const userId = await deps.db(async (c) => {
    await c.query("BEGIN");
    try {
      // Serialise concurrent accepts of the same address; the second one finds the first one's rows.
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`signup:${pending.email}`]);
      const existing = await resolveIdentity(c, { provider: pending.provider as Provider, subject: pending.subject, email: pending.email, emailVerified: true });
      if (existing) {
        await c.query("ROLLBACK");
        return null;
      }
      const id = await insertUser(c, pending, now);
      await c.query("COMMIT");
      return id;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
  if (!userId) return { ok: false, reason: "expired" };
  const session = await startSession(deps, { userId, client: "web", previousToken: ctx.previousToken, ua: ctx.ua });
  return { ok: true, userId, session };
}

async function insertUser(c: Queryable, p: PendingSignup, now: Date): Promise<string> {
  const id = randomUUID();
  await c.query("INSERT INTO users (id, email, email_verified_at) VALUES ($1, $2, $3)", [id, p.email, now]);
  await c.query("INSERT INTO auth_identities (user_id, provider, subject, verified_at) VALUES ($1, $2, $3, $4)", [id, p.provider, p.subject, now]);
  for (const kind of ["age_18_plus", "terms", "privacy"]) {
    await c.query("INSERT INTO consents (user_id, kind, granted, doc_version) VALUES ($1, $2, true, $3)", [id, kind, LEGAL_DOC_VERSION]);
  }
  return id;
}
