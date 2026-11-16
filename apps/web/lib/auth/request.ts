import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { clientIp, trustProxyHops } from "../rate-limit";
import { readCookie, sessionCookieName, PENDING_COOKIE, cookieName, type CookieSpec } from "./cookies";
import { accountsEnabled } from "./flags";
import { isSameOrigin } from "./origin";
import { defaultAuthDeps, sessionFromToken, type LiveSession } from "./session";

/**
 * Shared front door for the auth server actions: flag off is a 404, a cross-origin post is refused,
 * and the caller gets the request facts it needs (client IP, user agent, current session token).
 */
export type ActionRequest = {
  ok: true;
  ip: string;
  ua: string | null;
  sessionToken: string | null;
  pendingValue: string | null;
};
export type ActionRefusal = { ok: false; reason: "bad_origin" };

export async function openAction(): Promise<ActionRequest | ActionRefusal> {
  const req = await openRead();
  const h = await headers();
  if (!isSameOrigin(h)) return { ok: false, reason: "bad_origin" };
  return req;
}

/**
 * Read-only entry for server components and queries: flag check and cookies, no Origin check (browsers send no Origin
 * on a same-origin navigation GET). Never use it for a mutation.
 */
export async function openRead(): Promise<ActionRequest> {
  if (!(await accountsEnabled())) notFound();
  const h = await headers();
  const jar = await cookies();
  return {
    ok: true,
    ip: clientIp(h, { hops: trustProxyHops() }),
    ua: h.get("user-agent"),
    sessionToken: jar.get(sessionCookieName())?.value ?? null,
    pendingValue: jar.get(cookieName(PENDING_COOKIE))?.value ?? null,
  };
}

export async function setCookie(c: CookieSpec): Promise<void> {
  (await cookies()).set(c.name, c.value, c.options);
}

/** The signed-in person for an action, or null. */
export async function currentSession(req: ActionRequest): Promise<LiveSession | null> {
  return sessionFromToken(defaultAuthDeps(), req.sessionToken);
}

export { readCookie };
