import { createHash, timingSafeEqual } from "node:crypto";

export type OpsAccess = "ok" | "hidden";

const digest = (s: string) => createHash("sha256").update(s).digest();

export const OPS_COOKIE = "hirelane_ops";

/**
 * Gate for /ops until Phase 4 admin roles. The token is accepted from the x-ops-token header or the
 * httpOnly cookie set by POST /ops/session, never from the URL, so it can't leak into logs, history or
 * Referer. Both sides are hashed so the compare is constant time whatever the lengths. Unset token and
 * wrong token look the same: the page is hidden (404).
 */
export function opsAccess(input: {
  configured: string | undefined;
  header: string | null;
  cookie: string | null;
}): OpsAccess {
  const { configured, header, cookie } = input;
  if (!configured) return "hidden";
  const expected = digest(configured);
  for (const given of [header, cookie]) {
    if (given && timingSafeEqual(expected, digest(given))) return "ok";
  }
  return "hidden";
}
