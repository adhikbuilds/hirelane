import { cookies } from "next/headers";
import { sessionCookieName } from "./auth/cookies";
import { defaultAuthDeps, sessionFromToken } from "./auth/session";

export type Session = { userId: string };

/**
 * The signed-in user for this request, or null. Reads the opaque `__Host-hl_session` cookie and checks it against the
 * sessions table (revoked, expired and unknown tokens are all null). No cookie means no database call.
 */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  const live = await sessionFromToken(defaultAuthDeps(), token);
  return live ? { userId: live.userId } : null;
}
