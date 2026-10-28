import { accountsEnabled } from "@/lib/auth/flags";
import { handleLinkedInStart, loadLinkedInConfig } from "@/lib/auth/linkedin";
import { defaultAuthDeps } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return handleLinkedInStart(req, { deps: defaultAuthDeps(), config: loadLinkedInConfig(), fetch, enabled: () => accountsEnabled() });
}
