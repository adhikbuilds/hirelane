import { handleOidcCallback, handleOidcStart, isPublicHttps, verifyOidcIdToken, type IdTokenResult, type OidcConfig, type OidcRouteCtx, type OidcSpec } from "./oidc-shared";

/**
 * Sign in with LinkedIn: OpenID Connect only (scopes openid, profile, email). We read three claims from the signed ID
 * token (email, email_verified, name) and call nothing else on LinkedIn: no profile API, no cookies, no scraping
 * (LinkedIn User Agreement s.8.2).
 *
 * PKCE: S256 is sent when LinkedIn's discovery document advertises it in code_challenge_methods_supported. When it does
 * not, the flow falls back to state (CSRF) + nonce (ID token replay) + the confidential client secret on the token
 * request. This is deliberate: sending code_challenge to an endpoint that ignores or rejects it would break sign-in,
 * and the fallback is the standard confidential-client protection. The ID token is verified through discovery + JWKS.
 */
const LINKEDIN_ISSUER = "https://www.linkedin.com/oauth";
// LinkedIn has been seen to mint ID tokens whose iss is the bare site origin. Both are LinkedIn-controlled and the
// signature is still checked against the discovered JWKS, so accepting either does not widen trust.
const LINKEDIN_ISSUER_ALT = "https://www.linkedin.com";

export const LINKEDIN_START_LIMIT = 20;

export type LinkedInRouteCtx = OidcRouteCtx;

/** From env, or null when LinkedIn sign-in is not configured. Fails closed in production without https. */
export function loadLinkedInConfig(env: Record<string, string | undefined> = process.env): OidcConfig | null {
  const clientId = env["LINKEDIN_CLIENT_ID"]?.trim();
  const clientSecret = env["LINKEDIN_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) return null;
  const prod = env["NODE_ENV"] === "production";
  const configured = env["HIRELANE_APP_ORIGIN"]?.trim().replace(/\/$/, "");
  if (prod && (!configured || !isPublicHttps(configured))) return null;
  const issuer = env["HIRELANE_LINKEDIN_ISSUER"]?.trim() || LINKEDIN_ISSUER;
  if (prod && !isPublicHttps(issuer)) return null;
  const origin = configured || "http://localhost:3001";
  return { issuer, clientId, clientSecret, redirectUri: `${origin}/auth/linkedin/callback` };
}

/** For the sign-in button: true only when both secrets are set and the config would load. */
export function linkedinEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return loadLinkedInConfig(env) !== null;
}

const altIssuers = (config: OidcConfig): string[] => (config.issuer === LINKEDIN_ISSUER ? [LINKEDIN_ISSUER_ALT] : []);
const issuers = (config: OidcConfig): string[] => [config.issuer, ...altIssuers(config)];

const SPEC: OidcSpec = {
  provider: "linkedin",
  scope: "openid profile email",
  pkce: "if-advertised",
  altIssuers,
  limitKey: "oidc-start-linkedin-ip",
  limit: LINKEDIN_START_LIMIT,
  errorCode: "linkedin",
};

/** Same checks as Google's, plus the sanitised display name. Anything off returns {ok:false}. */
export function verifyLinkedInIdToken(
  idToken: string,
  opts: { config: OidcConfig; fetch: typeof fetch; nonce: string; now: Date; jwksUri?: string },
): Promise<IdTokenResult> {
  return verifyOidcIdToken(idToken, { ...opts, issuers: issuers(opts.config), withName: true, altDiscoveryIssuers: altIssuers(opts.config) });
}

export const handleLinkedInStart = (req: Request, ctx: LinkedInRouteCtx): Promise<Response> => handleOidcStart(req, ctx, SPEC);
export const handleLinkedInCallback = (req: Request, ctx: LinkedInRouteCtx): Promise<Response> => handleOidcCallback(req, ctx, SPEC, issuers);
