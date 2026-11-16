/**
 * Cookie names, attributes and a tiny serializer. Kept free of next/headers so route handlers and tests share it.
 *
 * __Host- cookies must be Secure, Path=/ and carry no Domain. Playwright Chromium accepted one over http://localhost
 * (checked 2026-10-29). WebKit and Firefox were NOT checked (their binaries are not installed here); Safari is reported
 * to refuse Secure cookies over plain http but that is unverified. If a browser drops it, set
 * HIRELANE_INSECURE_DEV_COOKIE=1 for unprefixed, non-Secure dev names. The override is ignored in production.
 */
type Env = Record<string, string | undefined>;

export const SESSION_COOKIE = "__Host-hl_session";
export const PENDING_COOKIE = "__Host-hl_pending";
export const OIDC_COOKIE = "__Host-hl_oidc";

const DEV_NAMES: Record<string, string> = {
  [SESSION_COOKIE]: "hl_session_dev",
  [PENDING_COOKIE]: "hl_pending_dev",
  [OIDC_COOKIE]: "hl_oidc_dev",
};

export function insecureDevCookies(env: Env = process.env): boolean {
  return env["HIRELANE_INSECURE_DEV_COOKIE"] === "1" && env["NODE_ENV"] !== "production";
}

export const cookieName = (base: string, env: Env = process.env): string => (insecureDevCookies(env) ? (DEV_NAMES[base] ?? base) : base);
export const sessionCookieName = (env: Env = process.env): string => cookieName(SESSION_COOKIE, env);

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge?: number;
}
export interface CookieSpec {
  name: string;
  value: string;
  options: CookieOptions;
}

function spec(base: string, value: string, maxAge: number, env: Env): CookieSpec {
  return {
    name: cookieName(base, env),
    value,
    // Lax (not Strict): the OIDC cookie must survive Google's cross-site redirect back to the callback.
    options: { httpOnly: true, secure: !insecureDevCookies(env), sameSite: "lax", path: "/", maxAge },
  };
}

export const sessionCookie = (token: string, maxAgeSeconds: number, env: Env = process.env): CookieSpec => spec(SESSION_COOKIE, token, maxAgeSeconds, env);
export const clearSessionCookie = (env: Env = process.env): CookieSpec => spec(SESSION_COOKIE, "", 0, env);
export const pendingCookie = (value: string, maxAgeSeconds: number, env: Env = process.env): CookieSpec => spec(PENDING_COOKIE, value, maxAgeSeconds, env);
export const clearPendingCookie = (env: Env = process.env): CookieSpec => spec(PENDING_COOKIE, "", 0, env);
export const oidcCookie = (value: string, maxAgeSeconds: number, env: Env = process.env): CookieSpec => spec(OIDC_COOKIE, value, maxAgeSeconds, env);
export const clearOidcCookie = (env: Env = process.env): CookieSpec => spec(OIDC_COOKIE, "", 0, env);

/** Set-Cookie header value. Values must already be cookie-safe (tokens and base64url); anything else throws. */
export function serializeCookie(c: CookieSpec): string {
  if (!/^[A-Za-z0-9_.~%+\-=]*$/.test(c.value)) throw new Error("cookie value is not cookie-safe");
  const parts = [`${c.name}=${c.value}`, `Path=${c.options.path}`];
  if (c.options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(c.options.maxAge))}`);
  if (c.options.httpOnly) parts.push("HttpOnly");
  if (c.options.secure) parts.push("Secure");
  parts.push("SameSite=Lax");
  return parts.join("; ");
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
