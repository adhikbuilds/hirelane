import { handleOidcCallback, handleOidcStart, isPublicHttps, verifyOidcIdToken, type IdTokenResult, type OidcConfig, type OidcRouteCtx, type OidcSpec } from "./oidc-shared";

export { discover, type IdTokenResult, type OidcConfig } from "./oidc-shared";

/** Google OpenID Connect: authorization code flow with PKCE (S256), state and nonce. The flow itself lives in oidc-shared. */

const GOOGLE_ISSUER = "https://accounts.google.com";

/** From env, or null when Google sign-in is not configured. The redirect URI is always on this app's own origin. */
export function loadOidcConfig(env: Record<string, string | undefined> = process.env): OidcConfig | null {
  const clientId = env["HIRELANE_GOOGLE_CLIENT_ID"]?.trim();
  const clientSecret = env["HIRELANE_GOOGLE_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) return null;
  const prod = env["NODE_ENV"] === "production";
  const configured = env["HIRELANE_APP_ORIGIN"]?.trim().replace(/\/$/, "");
  // Production fails closed: an explicit https origin is required, and the issuer must be a public https URL.
  if (prod && (!configured || !isPublicHttps(configured))) return null;
  const issuer = env["HIRELANE_OIDC_ISSUER"]?.trim() || GOOGLE_ISSUER;
  if (prod && !isPublicHttps(issuer)) return null;
  const origin = configured || "http://localhost:3001";
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: `${origin}/auth/google/callback`,
  };
}

export type GoogleRouteCtx = OidcRouteCtx;

export const GOOGLE_START_LIMIT = 20;

const googleIssuers = (config: OidcConfig): string[] => (config.issuer === GOOGLE_ISSUER ? [GOOGLE_ISSUER, "accounts.google.com"] : [config.issuer]);

const SPEC: OidcSpec = {
  provider: "google",
  scope: "openid email",
  extraAuthParams: { prompt: "select_account" },
  pkce: "always",
  limitKey: "oidc-start-ip",
  limit: GOOGLE_START_LIMIT,
  errorCode: "google",
};

/** Signature (RS256 only), issuer, audience, expiry, issued-at, nonce and verified email. Anything off returns {ok:false}. */
export async function verifyIdToken(
  idToken: string,
  opts: { config: OidcConfig; fetch: typeof fetch; nonce: string; now: Date; jwksUri?: string },
): Promise<IdTokenResult> {
  return verifyOidcIdToken(idToken, { ...opts, issuers: googleIssuers(opts.config) });
}

export const handleGoogleStart = (req: Request, ctx: GoogleRouteCtx): Promise<Response> => handleOidcStart(req, ctx, SPEC);
export const handleGoogleCallback = (req: Request, ctx: GoogleRouteCtx): Promise<Response> => handleOidcCallback(req, ctx, SPEC, googleIssuers);
