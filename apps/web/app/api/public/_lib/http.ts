import { createHash } from "node:crypto";

/** GET only, any origin, no credentials. ETag and Retry-After are readable from browser code. */
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "If-None-Match, Accept",
  "Access-Control-Expose-Headers": "ETag, Retry-After, RateLimit-Limit, RateLimit-Remaining",
  "Access-Control-Max-Age": "86400",
};

export const CACHE_PUBLIC = "public, s-maxage=300, stale-while-revalidate=60";

export type ApiErrorCode = "invalid_param" | "page_out_of_range" | "rate_limited" | "busy" | "not_found" | "internal_error";

export function errorResponse(status: number, code: ApiErrorCode, message: string, extra: { param?: string; headers?: Record<string, string> } = {}): Response {
  const error: { code: ApiErrorCode; message: string; param?: string } = { code, message };
  if (extra.param) error.param = extra.param;
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra.headers },
  });
}

export const weakEtag = (body: string): string => `W/"${createHash("sha1").update(body).digest("hex")}"`;

/** Weak comparison per RFC 9110 13.1.2: `W/` prefixes are ignored, `*` matches anything. */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const strip = (t: string) => t.trim().replace(/^W\//, "");
  const mine = strip(etag);
  return ifNoneMatch.split(",").some((t) => t.trim() === "*" || strip(t) === mine);
}

/** 200 with an ETag, or 304 when the client already holds this exact body. */
export function cachedJson(req: Request, payload: unknown, extra: Record<string, string> = {}): Response {
  const body = JSON.stringify(payload);
  const etag = weakEtag(body);
  const headers = { ...CORS_HEADERS, ETag: etag, "Cache-Control": CACHE_PUBLIC, ...extra };
  if (etagMatches(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

export const optionsResponse = (): Response => new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
