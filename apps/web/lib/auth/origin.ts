type Env = Record<string, string | undefined>;
type HeaderGetter = { get: (name: string) => string | null };

function configuredOrigin(env: Env): string | null {
  const raw = env["HIRELANE_APP_ORIGIN"]?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF defence for cookie mutations: the request must carry an Origin that equals this app's origin.
 * Expected origin is HIRELANE_APP_ORIGIN when set, otherwise the Host header (never X-Forwarded-Host, which a
 * client can set). A missing or "null" Origin fails: browsers always send Origin on cross-site POSTs.
 */
export function isSameOrigin(headers: HeaderGetter, env: Env = process.env): boolean {
  const origin = headers.get("origin");
  if (!origin || origin === "null") return false;
  let given: URL;
  try {
    given = new URL(origin);
  } catch {
    return false;
  }
  const fixed = configuredOrigin(env);
  if (fixed) return given.origin === fixed;
  // Production without a configured origin fails closed: the Host header is not a trust anchor there.
  if (env["NODE_ENV"] === "production") return false;
  const host = headers.get("host");
  return !!host && given.host === host && (given.protocol === "http:" || given.protocol === "https:");
}

/** Absolute origin for redirects: the configured one, else the origin of the incoming request URL. */
export function appOrigin(env: Env, requestUrl: string): string {
  return configuredOrigin(env) ?? new URL(requestUrl).origin;
}
