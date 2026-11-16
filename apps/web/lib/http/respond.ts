import { toProblem } from "@hirelane/services";

const BASE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

export function jsonResponse(status: number, body: unknown, requestId: string, extra: HeadersInit = {}): Response {
  const h = new Headers({ ...BASE, "X-Request-Id": requestId, ...Object.fromEntries(new Headers(extra)) });
  if (status === 204 || status === 304) return new Response(null, { status, headers: h });
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** RFC 9457 problem+json. `error` is run through toProblem, so an unknown error is a bare 500 with no message. */
export function problemResponse(error: unknown, requestId: string, extra: HeadersInit = {}): Response {
  const p = toProblem(error, requestId);
  const h = new Headers({ ...BASE, "X-Request-Id": requestId, ...Object.fromEntries(new Headers(extra)) });
  h.set("Content-Type", "application/problem+json; charset=utf-8");
  return new Response(JSON.stringify(p), { status: p.status, headers: h });
}
