import { defaultAuthDeps, sessionFromToken } from "../auth/session";
import { readCookie, sessionCookieName } from "../auth/cookies";

export interface Principal {
  userId: string;
  client: "web" | "android";
  via: "cookie" | "bearer";
}

/**
 * The single seam for "who is calling". Today: the `__Host-` session cookie. Bearer (`Authorization: Bearer hl_at_...`,
 * HLD I10, Android at C3) is recognised and refused with 401 until it is switched on; turning it on means resolving the
 * token below and returning via:"bearer", which also skips the Origin check (a Bearer client is not a browser).
 */
export async function resolvePrincipal(headers: Headers): Promise<Principal | null> {
  if (headers.get("authorization")) return null; // Bearer: designed, not enabled
  const token = readCookie(headers.get("cookie"), sessionCookieName());
  if (!token || !token.startsWith("hl_s_")) return null;
  const s = await sessionFromToken(defaultAuthDeps(), token);
  return s ? { userId: s.userId, client: s.client, via: "cookie" } : null;
}
