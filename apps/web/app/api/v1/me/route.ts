import { getMe } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = v1({}, async ({ ctx }) => ({ status: 200, body: await getMe(ctx) }));
