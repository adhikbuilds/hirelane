/**
 * Fixed-window rate limiting through the `rate_limits` table, keyed by client IP.
 *
 * The IP comes ONLY from the configured trusted-proxy depth (env TRUST_PROXY_HOPS, default 0):
 *  - 0: no proxy is trusted, X-Forwarded-For is never read. The caller supplies the socket address; without one the
 *       client is "unknown" and shares a single bucket. That fails safe: a spoofed header cannot buy a fresh bucket.
 *       (Next route handlers do not expose the socket, so a bare `next start` shares one bucket. Run behind a proxy
 *       and set the hop count for per-client limits.)
 *  - N >= 1: the entry N places from the right of X-Forwarded-For, i.e. the address the outermost trusted proxy saw.
 *       Entries to its left are client-controlled and ignored.
 */
import { isIP } from "node:net";

export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

const MAX_HOPS = 10;

let warnedNoHops = false;

export function trustProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = env["TRUST_PROXY_HOPS"];
  // Behind a proxy (Vercel and most hosts) hops=0 puts every client in one shared bucket. Say so loudly.
  if (!raw && env["NODE_ENV"] === "production" && !warnedNoHops) {
    warnedNoHops = true;
    console.warn("[rate-limit] TRUST_PROXY_HOPS is unset in production: all clients share one rate-limit bucket. Set it to your proxy depth (1 on Vercel).");
  }
  if (!raw || !/^\d{1,2}$/.test(raw)) return 0;
  const n = Number(raw);
  return n <= MAX_HOPS ? n : 0;
}

/** Expands an IPv6 literal into 8 hextets, or null when malformed. */
function expandV6(ip: string): string[] | null {
  const dbl = ip.split("::");
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(":") : [];
  const tail = dbl.length === 2 && dbl[1] ? dbl[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (dbl.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array(dbl.length === 2 ? missing : 0).fill("0"), ...tail];
  return all.length === 8 ? all.map((h) => h.replace(/^0+(?=.)/, "").toLowerCase()) : null;
}

function normalise(raw: string | undefined | null): string {
  if (!raw) return "unknown";
  let s = raw.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  if (s.startsWith("[") && s.includes("]")) s = s.slice(1, s.indexOf("]"));
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  if (mapped?.[1]) s = mapped[1];
  const kind = isIP(s);
  if (kind === 4) return s;
  if (kind === 6) {
    const parts = expandV6(s);
    return parts ? `${parts.slice(0, 4).join(":")}::/64` : "unknown";
  }
  return "unknown";
}

export function clientIp(
  headers: { get: (name: string) => string | null },
  opts: { hops: number; socketAddress?: string | null },
): string {
  if (opts.hops <= 0) return normalise(opts.socketAddress);
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim());
  if (chain.length < opts.hops || chain.every((p) => p === "")) return "unknown";
  return normalise(chain[chain.length - opts.hops]);
}

export type RateLimitResult = { allowed: boolean; limit: number; remaining: number; retryAfter: number; resetAt: Date };

/**
 * Counts one request in the current fixed window. One atomic upsert, so concurrent requests are counted exactly.
 * `prune` deletes windows older than an hour; callers pass it on a small fraction of requests.
 */
export async function checkRateLimit(
  client: Queryable,
  bucket: string,
  opts: { limit: number; windowSeconds: number; now?: Date; prune?: boolean },
): Promise<RateLimitResult> {
  const now = opts.now ?? new Date();
  const ms = opts.windowSeconds * 1000;
  const start = new Date(Math.floor(now.getTime() / ms) * ms);
  const { rows } = await client.query(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [bucket, start],
  );
  if (opts.prune) {
    await client.query("DELETE FROM rate_limits WHERE window_start < $1", [new Date(now.getTime() - 3_600_000)]);
  }
  const count = Number(rows[0].count);
  const resetAt = new Date(start.getTime() + ms);
  return {
    allowed: count <= opts.limit,
    limit: opts.limit,
    remaining: Math.max(0, opts.limit - count),
    retryAfter: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
    resetAt,
  };
}
