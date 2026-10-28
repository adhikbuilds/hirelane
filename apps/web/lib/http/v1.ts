import { createHash } from "node:crypto";
import { hmac } from "@hirelane/vault";
import { fingerprint, isServiceError, notFound, runIdempotent, ServiceError, type ServiceCtx } from "@hirelane/services";
import { accountsEnabled } from "../auth/flags";
import { isSameOrigin } from "../auth/origin";
import { defaultAuthDeps } from "../auth/session";
import { checkRateLimit, clientIp, guardedLimit, trustProxyHops } from "../rate-limit";
import { readCapped } from "./body";
import { serviceCtxFor, v1Keys } from "./ctx";
import { resolvePrincipal, type Principal } from "./principal";
import { jsonResponse, problemResponse } from "./respond";

export type RateClass = { name: string; max: number; windowSeconds: number };
const READ: RateClass = { name: "read", max: 120, windowSeconds: 60 };
const WRITE: RateClass = { name: "write", max: 40, windowSeconds: 60 };
export const UPLOAD_RATE: RateClass = { name: "upload", max: 10, windowSeconds: 600 };

const JSON_BODY_MAX = 64 * 1024;

export interface V1Options {
  /** State-changing: Origin check for cookies, Idempotency-Key required. */
  mutation?: boolean;
  /** Default true for a mutation. False only where a stored response cannot exist (account delete removes the key's owner). */
  idempotent?: boolean;
  /** 'json' parses a JSON body (<= 64 KB); 'raw' buffers up to `rawMax` bytes (hard cap); 'none' (default) reads nothing. */
  body?: "json" | "raw" | "none";
  rawMax?: number;
  rate?: RateClass;
}

export interface V1Context {
  req: Request;
  ctx: ServiceCtx;
  principal: Principal;
  requestId: string;
  params: Record<string, string>;
  /** Parsed JSON body (body: 'json'), else undefined. */
  input: unknown;
  /** Buffered body (body: 'raw'), else empty. */
  raw: Buffer;
  /** Keyed hash of the client IP for the audit log; never the address. */
  ipHash(): Promise<string | null>;
}
export type V1Result = { status: number; body?: unknown; headers?: HeadersInit } | Response;
export type V1Handler = (c: V1Context) => Promise<V1Result>;
/** The second argument Next passes; `any` so one wrapper fits static and [id] routes under Next's route type check. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteArg = { params: Promise<any> };

const newRequestId = (): string => crypto.randomUUID();

/**
 * Wraps a /api/v1 handler. Order matters and is fixed:
 *   accounts flag (404) -> session (401) -> Origin on cookie mutations (403) -> per-user rate limit (429)
 *   -> body read with a cap -> Idempotency-Key replay (mutations) -> handler -> JSON or problem+json.
 * The handler gets a ServiceCtx for the caller and never sees cookies or tokens. Unknown errors become a bare 500.
 */
export function v1(opts: V1Options, handler: V1Handler): (req: Request, route: RouteArg) => Promise<Response> {
  return async (req, route) => {
    const requestId = newRequestId();
    try {
      if (!(await accountsEnabled())) throw notFound();
      const principal = await resolvePrincipal(req.headers);
      if (!principal) throw new ServiceError("unauthenticated", 401);
      if (opts.mutation && principal.via === "cookie" && !isSameOrigin(req.headers)) throw new ServiceError("bad_origin", 403);

      const cls = opts.rate ?? (opts.mutation ? WRITE : READ);
      const gate = await guardedLimit(() =>
        defaultAuthDeps().db((c) => checkRateLimit(c, `v1:${cls.name}:${principal.userId}`, { limit: cls.max, windowSeconds: cls.windowSeconds, prune: Math.random() < 0.02 })),
      );
      const rateHeaders = { "RateLimit-Limit": String(gate.limit), "RateLimit-Remaining": String(gate.remaining) };
      if (!gate.allowed) {
        return problemResponse(new ServiceError(gate.busy ? "busy" : "rate_limited", gate.busy ? 503 : 429), requestId, { "Retry-After": String(gate.retryAfter), ...rateHeaders });
      }

      let input: unknown;
      let raw: Buffer = Buffer.alloc(0);
      const mode = opts.body ?? "none";
      if (mode === "json") {
        const ct = req.headers.get("content-type") ?? "";
        if (!/^application\/json(\s*;|$)/i.test(ct)) throw new ServiceError("unsupported_media_type", 415);
        raw = await readCapped(req, JSON_BODY_MAX);
        try {
          input = JSON.parse(raw.toString("utf8"));
        } catch {
          throw new ServiceError("invalid_json", 400);
        }
      } else if (mode === "raw") {
        raw = await readCapped(req, opts.rawMax ?? JSON_BODY_MAX);
      }

      const params: Record<string, string> = route?.params ? await route.params : {};
      const ctx = serviceCtxFor(principal.userId, { requestId });
      const c: V1Context = {
        req,
        ctx,
        principal,
        requestId,
        params,
        input,
        raw,
        ipHash: async () => {
          const ip = clientIp(req.headers, { hops: trustProxyHops() });
          return ip && ip !== "unknown" ? hmac(v1Keys(), "file-access/ip", ip) : null;
        },
      };

      let result: V1Result;
      if (opts.mutation && opts.idempotent !== false) {
        const key = req.headers.get("idempotency-key");
        if (!key) throw new ServiceError("idempotency_key_required", 400);
        const url = new URL(req.url);
        // The query string is part of what the key is bound to (an upload's ?label= is not a replay of another label).
        const fp = fingerprint(req.method, url.pathname + url.search, createHash("sha256").update(raw).digest("hex"));
        const once = await runIdempotent(ctx, { key, fp }, async () => {
          const r = await handler(c);
          if (r instanceof Response) throw new ServiceError("handler_returned_response", 500);
          return { status: r.status, body: r.body ?? null };
        });
        result = { status: once.status, body: once.body, headers: once.replayed ? { "Idempotent-Replayed": "true" } : undefined };
      } else {
        result = await handler(c);
      }
      if (result instanceof Response) return result;
      return jsonResponse(result.status, result.body, requestId, { ...rateHeaders, ...(result.headers ? Object.fromEntries(new Headers(result.headers)) : {}) });
    } catch (e) {
      if (!isServiceError(e)) console.error(`[v1] unhandled ${e instanceof Error ? e.name : "error"} ${requestId}`);
      return problemResponse(e, requestId);
    }
  };
}


/**
 * The WRITE rate class for the server-action twins: same per-user budget and bucket as a v1 mutation, so a form cannot
 * be used to get round the API's limit. Returns null when allowed, else the failing status and code.
 */
export async function writeRateGate(userId: string): Promise<{ status: number; code: string } | null> {
  const gate = await guardedLimit(() =>
    defaultAuthDeps().db((c) => checkRateLimit(c, `v1:${WRITE.name}:${userId}`, { limit: WRITE.max, windowSeconds: WRITE.windowSeconds, prune: Math.random() < 0.02 })),
  );
  if (gate.allowed) return null;
  return gate.busy ? { status: 503, code: "busy" } : { status: 429, code: "rate_limited" };
}
