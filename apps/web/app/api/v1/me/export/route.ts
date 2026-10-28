import { exportMe } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = v1({ rate: { name: "export", max: 5, windowSeconds: 600 } }, async ({ ctx }) => ({ status: 200, body: await exportMe(ctx) }));
