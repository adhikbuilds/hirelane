import { unstable_cache } from "next/cache";
import { z } from "zod";
import { ROLE_FAMILIES } from "@hirelane/engine";
import { withAdmin } from "@hirelane/db";
import { checkRateLimit, clientIp, trustProxyHops, type RateLimitResult } from "../../../../../lib/rate-limit";
import { buildSnapshot, perWeekFrom, PROXY_METHOD, WINDOW_DAYS, type ProxyJob, type Snapshot } from "../../../../../lib/autopilot-proxy";
import { cachedJson, errorResponse } from "../../_lib/http";

const RATE_LIMIT = 60;
const RATE_WINDOW_SECONDS = 60;
export const DEFAULT_MIN = 70;

const query = z
  .object({
    min: z
      .string()
      .regex(/^\d{1,3}$/, "min must be a whole number from 0 to 100")
      .transform(Number)
      .pipe(z.number().int().min(0, "min must be from 0 to 100").max(100, "min must be from 0 to 100"))
      .optional(),
    role: z.enum(ROLE_FAMILIES, { error: "role must be one of the role families listed in /openapi.json" }).optional(),
  })
  .strict();

export type AutopilotDeps = {
  /** Scored recent jobs, already cached for 300 s in production. */
  snapshot: () => Promise<Snapshot>;
  limit: (ip: string) => Promise<RateLimitResult>;
  hops: () => number;
};

const SNAPSHOT_SQL = `
SELECT role_family, skills
  FROM jobs
 WHERE coalesce(posted_at, first_seen_at) >= $1::timestamptz - make_interval(days => $2)
   AND coalesce(posted_at, first_seen_at) <= $1::timestamptz`;

export async function loadSnapshot(now: Date = new Date()): Promise<Snapshot> {
  const jobs = await withAdmin(async (c) => {
    const { rows } = await c.query(SNAPSHOT_SQL, [now, WINDOW_DAYS]);
    return rows.map((r): ProxyJob => ({ roleFamily: r.role_family ?? null, skills: r.skills ?? [] }));
  });
  return buildSnapshot(jobs, now);
}

const cachedSnapshot = unstable_cache(() => loadSnapshot(), ["autopilot-proxy-v1"], { revalidate: 300, tags: ["jobs"] });

export const defaultAutopilotDeps: AutopilotDeps = {
  snapshot: () => cachedSnapshot(),
  limit: (ip) =>
    withAdmin((c) =>
      checkRateLimit(c, `public-api:${ip}`, { limit: RATE_LIMIT, windowSeconds: RATE_WINDOW_SECONDS, prune: Math.random() < 0.01 }),
    ),
  hops: () => trustProxyHops(),
};

export function createAutopilotHandler(deps: AutopilotDeps = defaultAutopilotDeps) {
  return async function GET(req: Request): Promise<Response> {
    let headers: Record<string, string> = {};
    try {
      try {
        const r = await deps.limit(clientIp(req.headers, { hops: deps.hops(), socketAddress: null }));
        headers = { "RateLimit-Limit": String(r.limit), "RateLimit-Remaining": String(r.remaining) };
        if (!r.allowed) {
          return errorResponse(429, "rate_limited", `Rate limit of ${r.limit} requests per minute exceeded`, {
            headers: { ...headers, "Retry-After": String(r.retryAfter) },
          });
        }
      } catch (e) {
        // A limiter outage fails open: this is a public read-only route.
        console.error("autopilot stats rate limiter unavailable", e instanceof Error ? e.message : e);
      }

      const params = new URL(req.url).searchParams;
      const seen = new Set<string>();
      for (const k of params.keys()) {
        if (seen.has(k)) return errorResponse(400, "invalid_param", `Repeated parameter: ${k}`, { param: k, headers });
        seen.add(k);
      }
      const parsed = query.safeParse(Object.fromEntries(params));
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        const param = issue.code === "unrecognized_keys" ? String((issue as { keys?: string[] }).keys?.[0] ?? "") : String(issue.path[0] ?? "");
        return errorResponse(400, "invalid_param", issue.code === "unrecognized_keys" ? `Unknown parameter: ${param}` : issue.message, {
          ...(param ? { param } : {}),
          headers,
        });
      }
      const min = parsed.data.min ?? DEFAULT_MIN;
      const role = parsed.data.role ?? null;
      const snap = await deps.snapshot();
      return cachedJson(
        req,
        {
          perWeek: perWeekFrom(snap, min, role),
          asOf: snap.asOf,
          min,
          role,
          estimate: { label: "estimate", method: PROXY_METHOD, windowDays: WINDOW_DAYS, jobsInWindow: snap.jobsInWindow },
        },
        headers,
      );
    } catch (e) {
      console.error("autopilot stats error", e instanceof Error ? e.message : e);
      return errorResponse(500, "internal_error", "Something went wrong. Try again shortly.", { headers });
    }
  };
}
