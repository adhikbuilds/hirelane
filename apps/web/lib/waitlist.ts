/**
 * Early-access waitlist (audit UX-1). The only personal data Hirelane stores today: an email, an optional graduation
 * year and the time consent was given. The address is never logged.
 */
import { withAdmin } from "@hirelane/db";
import { z } from "zod";
import { checkRateLimit, clientIp, trustProxyHops, type Queryable, type RateLimitResult } from "./rate-limit";

export const WAITLIST_LIMIT = 20;
export const WAITLIST_WINDOW_SECONDS = 60;
const MAX_BODY_BYTES = 2048;
const SOURCES = ["landing", "pricing", "jobs"] as const;

export const waitlistInput = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  gradYear: z.number().int().min(2015).max(2035).nullable().optional(),
  source: z.enum(SOURCES).optional(),
  consent: z.literal(true),
});
export type WaitlistInput = z.infer<typeof waitlistInput>;

/** Adds the address; joining twice is a no-op so the response never reveals whether an address is already listed. */
export async function addToWaitlist(client: Queryable, v: WaitlistInput, now = new Date()): Promise<void> {
  await client.query(
    `INSERT INTO waitlist (email, grad_year, source, consent_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT ((lower(email))) DO NOTHING`,
    [v.email, v.gradYear ?? null, v.source ?? "landing", now],
  );
}

export type WaitlistDeps = {
  limit: (ip: string) => Promise<RateLimitResult>;
  save: (v: WaitlistInput) => Promise<void>;
  hops: () => number;
};

export const defaultWaitlistDeps: WaitlistDeps = {
  limit: (ip) =>
    withAdmin((c) =>
      checkRateLimit(c, `waitlist:${ip}`, { limit: WAITLIST_LIMIT, windowSeconds: WAITLIST_WINDOW_SECONDS, prune: Math.random() < 0.05 }),
    ),
  save: (v) => withAdmin((c) => addToWaitlist(c, v)),
  hops: () => trustProxyHops(),
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

/** Same-origin only: a browser form on this site, never a cross-site post. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export function createWaitlistHandler(deps: WaitlistDeps = defaultWaitlistDeps) {
  return async function POST(req: Request): Promise<Response> {
    if (!sameOrigin(req)) return json(403, { error: { code: "forbidden", message: "Cross-site requests are not accepted" } });
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
      return json(415, { error: { code: "unsupported_media_type", message: "Send JSON" } });
    }
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: { code: "too_large", message: "Request too large" } });

    // A write path fails closed: if the limiter is down, nothing is stored.
    let r: RateLimitResult;
    try {
      r = await deps.limit(clientIp(req.headers, { hops: deps.hops(), socketAddress: null }));
    } catch (e) {
      console.error("waitlist rate limiter unavailable", e instanceof Error ? e.message : "unknown");
      return json(503, { error: { code: "unavailable", message: "Try again in a minute" } });
    }
    if (!r.allowed) {
      return json(429, { error: { code: "rate_limited", message: "Too many sign-ups, try again shortly" } }, { "Retry-After": String(r.retryAfter) });
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: { code: "invalid_body", message: "Body is not JSON" } });
    }
    const parsed = waitlistInput.safeParse(body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? "body");
      return json(400, { error: { code: "invalid_param", param: field, message: field === "consent" ? "Tick the box to join" : `Check your ${field}` } });
    }

    try {
      await deps.save(parsed.data);
    } catch (e) {
      // Never log the address: only the error class.
      console.error("waitlist insert failed", e instanceof Error ? e.name : "unknown");
      return json(500, { error: { code: "internal_error", message: "Could not save, try again" } });
    }
    return json(201, { ok: true });
  };
}
