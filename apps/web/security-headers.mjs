/**
 * Security response headers, built from the environment so they can be tested for both modes.
 *
 * TODO(SEC-8): script-src keeps 'unsafe-inline'. A nonce or hash CSP needs per-request rendering of every page
 * (Next only applies a nonce to dynamically rendered routes), which would turn the statically cached board, job and
 * landing pages dynamic and drop their CDN caching. Revisit with Next's experimental SRI (hash based) support.
 * The rest of the policy is strict: object-src 'none', base-uri 'self', frame-ancestors 'none', form-action 'self'.
 */
export function buildCsp(env = process.env) {
  const isDev = env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    // Next injects inline bootstrap scripts; dev also needs eval for React refresh.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws://localhost:3001" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const HSTS_VALUE = "max-age=63072000; includeSubDomains";

/** @returns {{ key: string, value: string }[]} */
export function buildSecurityHeaders(env = process.env) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: buildCsp(env) },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ];
  // HSTS over plain-http localhost would pin browsers to https for a dev host, so production only.
  if (env.NODE_ENV === "production") headers.push({ key: "Strict-Transport-Security", value: HSTS_VALUE });
  return headers;
}
