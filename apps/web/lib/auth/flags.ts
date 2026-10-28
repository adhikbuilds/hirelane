import { isFeatureEnabled, withAuth } from "@hirelane/db";

type Env = Record<string, string | undefined>;

/**
 * The `accounts` flag (Amendment B section 10). Off means every auth route and action answers 404.
 * HIRELANE_ACCOUNTS=1 forces it on (dev, e2e), =0 forces it off; otherwise the global feature_flags row decides.
 * Any failure reading the flag counts as off.
 */
export async function accountsEnabled(opts: { env?: Env; read?: () => Promise<boolean> } = {}): Promise<boolean> {
  const env = opts.env ?? process.env;
  if (env["HIRELANE_ACCOUNTS"] === "1") return true;
  if (env["HIRELANE_ACCOUNTS"] === "0") return false;
  try {
    return await (opts.read ?? (() => withAuth((c) => isFeatureEnabled(c, "accounts"))))();
  } catch {
    return false;
  }
}
