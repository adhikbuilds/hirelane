import { confirmResume } from "@hirelane/services";
import { v1 } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = v1({ mutation: true, body: "json" }, async ({ ctx, params, input }) => {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return { status: 201, body: await confirmResume(ctx, { ...body, id: params["id"] }) };
});
