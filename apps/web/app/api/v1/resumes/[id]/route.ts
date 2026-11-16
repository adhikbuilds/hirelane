import { deleteResume, getResume } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = v1({}, async ({ ctx, params }) => ({ status: 200, body: await getResume(ctx, { id: params["id"] }) }));
export const DELETE = v1({ mutation: true }, async ({ ctx, params }) => ({ status: 200, body: await deleteResume(ctx, { id: params["id"] }) }));
