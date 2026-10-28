import { accountsEnabled } from "@/lib/auth/flags";
import { handleGoogleStart, loadOidcConfig } from "@/lib/auth/google";
import { defaultAuthDeps } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return handleGoogleStart(req, { deps: defaultAuthDeps(), config: loadOidcConfig(), fetch, enabled: () => accountsEnabled() });
}
