import { accountsEnabled } from "@/lib/auth/flags";
import { handleGoogleCallback, loadOidcConfig } from "@/lib/auth/google";
import { defaultAuthDeps } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return handleGoogleCallback(req, { deps: defaultAuthDeps(), config: loadOidcConfig(), fetch, enabled: () => accountsEnabled() });
}
