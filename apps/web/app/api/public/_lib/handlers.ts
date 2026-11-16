import { withAdmin } from "@hirelane/db";
import { checkRateLimit, clientIp, guardedLimit, scaledLimit, trustProxyHops, type RateLimitResult } from "../../../../lib/rate-limit";
import { parseStrict, serializeApi } from "../../../../lib/public-api-params";
import { appOrigin, pagesFor, searchJobs, type JobQuery, type JobsResult } from "../../../../lib/queries/jobs";
import { cachedJson, errorResponse, optionsResponse } from "./http";
import { getPublicJobDetail, SLUG_RE, type PublicJobDetail } from "./detail";

export const RATE_LIMIT = 60;
export const RATE_WINDOW_SECONDS = 60;

export type Deps = {
  search: (q: JobQuery) => Promise<JobsResult>;
  detail: (slug: string) => Promise<PublicJobDetail | null>;
  /** Counts one request for `ip`. */
  limit: (ip: string) => Promise<RateLimitResult>;
  hops: () => number;
};

export const defaultDeps: Deps = {
  search: (q) => searchJobs(q, { withFacets: false }),
  detail: (slug) => withAdmin((c) => getPublicJobDetail(c, slug, appOrigin())),
  limit: (ip) =>
    guardedLimit(() =>
      withAdmin((c) =>
        checkRateLimit(c, `public-api:${ip}`, { limit: scaledLimit(ip, RATE_LIMIT), windowSeconds: RATE_WINDOW_SECONDS, prune: Math.random() < 0.01 }),
      ),
    ),
  hops: () => trustProxyHops(),
};

export type Limited = { response: Response } | { headers: Record<string, string> };

/** Rate limits before any data work. A limiter outage fails closed with a visible 429 "busy" and Retry-After. */
export async function gate(req: Request, deps: Deps): Promise<Limited> {
  const r = await guardedLimit(() => deps.limit(clientIp(req.headers, { hops: deps.hops(), socketAddress: null })));
  return limitOutcome(r);
}

export function limitOutcome(r: RateLimitResult): Limited {
  if (r.busy) {
    return {
      response: errorResponse(429, "busy", "The service is busy. Try again shortly.", { headers: { "Retry-After": String(r.retryAfter) } }),
    };
  }
  const headers = { "RateLimit-Limit": String(r.limit), "RateLimit-Remaining": String(r.remaining) };
  if (r.allowed) return { headers };
  return {
    response: errorResponse(429, "rate_limited", `Rate limit of ${r.limit} requests per minute exceeded`, {
      headers: { ...headers, "Retry-After": String(r.retryAfter) },
    }),
  };
}

const internal = (e: unknown): Response => {
  console.error("public api error", e instanceof Error ? e.message : e);
  return errorResponse(500, "internal_error", "Something went wrong. Try again shortly.");
};

export function createJobsHandler(deps: Deps = defaultDeps) {
  return async function GET(req: Request): Promise<Response> {
    try {
      const limited = await gate(req, deps);
      if ("response" in limited) return limited.response;
      const parsed = parseStrict(new URL(req.url).searchParams);
      if (!parsed.ok) {
        const status = 400;
        return errorResponse(status, parsed.error.code, parsed.error.message, { param: parsed.error.param, headers: limited.headers });
      }
      const query = parsed.query;
      const { total, jobs } = await deps.search(query);
      const pages = pagesFor(total, query.pageSize);
      const link = (page: number) => {
        const qs = serializeApi({ ...query, page });
        return qs ? `/api/public/jobs?${qs}` : "/api/public/jobs";
      };
      return cachedJson(
        req,
        {
          jobs,
          page: query.page,
          pageSize: query.pageSize,
          pages,
          total,
          links: {
            self: link(query.page),
            next: query.page < pages ? link(query.page + 1) : null,
            prev: query.page > 1 ? link(Math.min(query.page - 1, pages)) : null,
          },
        },
        limited.headers,
      );
    } catch (e) {
      return internal(e);
    }
  };
}

export function createJobDetailHandler(deps: Deps = defaultDeps) {
  return async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
    try {
      const limited = await gate(req, deps);
      if ("response" in limited) return limited.response;
      const { slug } = await ctx.params;
      const job = SLUG_RE.test(slug) ? await deps.detail(slug) : null;
      if (!job) return errorResponse(404, "not_found", "No job with that slug", { headers: limited.headers });
      return cachedJson(req, job, limited.headers);
    } catch (e) {
      return internal(e);
    }
  };
}

export { optionsResponse };
