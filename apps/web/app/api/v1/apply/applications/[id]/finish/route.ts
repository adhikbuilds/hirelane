import { markFinishedByStudent } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Own application only (someone else's is 404). "I finished on their site": a blocked application becomes submitted by the student. */
export const POST = v1({ mutation: true }, async ({ ctx, params }) => ({ status: 200, body: await markFinishedByStudent(ctx, { id: params["id"] }) }));
