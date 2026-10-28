/**
 * Fixed-window rate limiting through the `rate_limits` table, keyed by client IP.
 *
 * Client identity, in order:
 *  1. `x-real-ip` when it is a valid IP, ONLY if env TRUST_X_REAL_IP=1 (opt-in). Set it only when the edge in front of
 *     this app overwrites any client-sent value (Vercel does). Otherwise a client could mint a new bucket per request.
 *  2. env TRUST_PROXY_HOPS = N >= 1: the entry N places from the right of X-Forwarded-For, i.e. the address the
 *     outermost trusted proxy saw. Entries to its left are client-controlled and ignored. With 0, X-Forwarded-For is never read.
 *  3. The socket address when the caller has one (Next route handlers do not expose it).
 *  4. Nothing identifies the client. In production the bucket is a short hash of user-agent + accept-language
 *     ("anon:<hash>"), so there is never ONE global bucket; it is weaker than an IP, so set x-real-ip or TRUST_PROXY_HOPS.
 *     In development/test it is the shared "local" key, whose budget is widened by `scaledLimit` so e2e runs are not starved.
 */
import { createHash } from "node:crypto";
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

const LOCAL_KEY = "local";
/** The shared dev/test key gets a wider budget so parallel e2e workers on one machine do not starve each other. */
const LOCAL_MULTIPLIER = 50;

export const isLocalKey = (key: string): boolean => key === LOCAL_KEY;
export const scaledLimit = (key: string, base: number): number => (isLocalKey(key) ? base * LOCAL_MULTIPLIER : base);

export function clientIp(
  headers: { get: (name: string) => string | null },
  opts: { hops: number; socketAddress?: string | null; env?: Record<string, string | undefined> },
): string {
  const env = opts.env ?? process.env;
  // x-real-ip is client-controlled unless the edge overwrites it, so it is read only on explicit opt-in.
  if (env["TRUST_X_REAL_IP"] === "1") {
    const real = normalise(headers.get("x-real-ip"));
    if (real !== "unknown") return real;
  }

  if (opts.hops > 0) {
    const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((p) => p.trim());
    if (chain.length >= opts.hops && !chain.every((p) => p === "")) {
      const viaChain = normalise(chain[chain.length - opts.hops]);
      if (viaChain !== "unknown") return viaChain;
    }
  }

  const socket = normalise(opts.socketAddress);
  if (socket !== "unknown") return socket;

  if (env["NODE_ENV"] !== "production") return LOCAL_KEY;
  const fp = `${headers.get("user-agent") ?? ""}\n${headers.get("accept-language") ?? ""}`;
  return `anon:${createHash("sha256").update(fp).digest("hex").slice(0, 16)}`;
}

/** `busy: true` means the limiter itself failed: the request was NOT counted and must not be served as if allowed. */
export type RateLimitResult = { allowed: boolean; limit: number; remaining: number; retryAfter: number; resetAt: Date; busy?: true };

export const BUSY_RETRY_SECONDS = 5;

/**
 * Runs a limiter call and converts any failure (DB down, missing table, pool exhausted) into a typed busy result.
 * Fails closed: `allowed` is false. Only the message of the error is logged, never request data.
 */
export async function guardedLimit(
  run: () => Promise<RateLimitResult>,
  opts: { log?: (msg: string) => void } = {},
): Promise<RateLimitResult> {
  try {
    return await run();
  } catch (e) {
    (opts.log ?? ((m) => console.error(m)))(`rate limiter unavailable: ${e instanceof Error ? e.name : "unknown"}`);
    return { allowed: false, busy: true, limit: 0, remaining: 0, retryAfter: BUSY_RETRY_SECONDS, resetAt: new Date(Date.now() + BUSY_RETRY_SECONDS * 1000) };
  }
}

/**
 * Counts one request in the current fixed window. One atomic upsert, so concurrent requests are counted exactly.
 * `prune` deletes windows older than an hour (`pruneAfterSeconds` overrides, e.g. for daily buckets); callers pass it on a small fraction of requests.
 */
export async function checkRateLimit(
  client: Queryable,
  bucket: string,
  opts: { limit: number; windowSeconds: number; now?: Date; prune?: boolean; pruneAfterSeconds?: number },
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
    await client.query("DELETE FROM rate_limits WHERE window_start < $1", [new Date(now.getTime() - (opts.pruneAfterSeconds ?? 3600) * 1000)]);
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
