"use server";

import { headers } from "next/headers";
import { withAdmin } from "@hirelane/db";
import { checkRateLimit, clientIp, guardedLimit, scaledLimit, trustProxyHops } from "@/lib/rate-limit";
import { MAX_PAGE, PAGE_SIZE, parseBoardParams } from "@/components/board/url-state";
import { toBoardRow, type BoardRow } from "@/components/board/row-model";
import { SUGGEST_MAX, previewsFor, searchJobs, suggestBoard, type BoardSuggestions, type JobPreviewData } from "@/lib/queries/jobs";

const MAX_QS = 600;
/** Board actions run on scroll, hover and keystrokes, so the budget is wider than the public API's, but still bounded. */
const ACTION_LIMIT = 300;
const ACTION_WINDOW_SECONDS = 60;

type Budget = "ok" | "limited" | "busy";

/** Per-IP budget shared by the three board actions. A limiter outage is reported as "busy", never silently allowed. */
async function budget(): Promise<Budget> {
  const r = await guardedLimit(async () => {
    const ip = clientIp(await headers(), { hops: trustProxyHops(), socketAddress: null });
    return withAdmin((c) =>
      checkRateLimit(c, `board-actions:${ip}`, { limit: scaledLimit(ip, ACTION_LIMIT), windowSeconds: ACTION_WINDOW_SECONDS, prune: Math.random() < 0.01 }),
    );
  });
  return r.busy ? "busy" : r.allowed ? "ok" : "limited";
}

/** Thrown by actions that have no empty-result shape of their own; the client shows its retry state. */
// Not exported: a "use server" module may only export async functions.
class BoardBusyError extends Error {
  constructor() {
    super("board_busy");
    this.name = "BoardBusyError";
  }
}

/** `busy: true` means the service could not check its budget; the client must show a retry message, not an empty page. */
export type MoreRows = { rows: BoardRow[]; page: number; hasMore: boolean; busy?: true };

/** One more page of the board for the same URL state. Same cached query as the server render, so counts never disagree. */
export async function loadMoreJobs(qs: string, page: number): Promise<MoreRows> {
  if (typeof qs !== "string" || qs.length > MAX_QS || !Number.isInteger(page) || page < 2 || page > MAX_PAGE) {
    return { rows: [], page: 1, hasMore: false };
  }
  const b = await budget();
  if (b === "busy") return { rows: [], page: 1, hasMore: false, busy: true };
  if (b === "limited") return { rows: [], page: 1, hasMore: false };
  const query = { ...parseBoardParams(new URLSearchParams(qs)), page, pageSize: PAGE_SIZE };
  const { total, jobs } = await searchJobs(query);
  const pref = query.filter.country === "IN" ? "INR" : "USD";
  const now = new Date();
  return { rows: jobs.map((j) => toBoardRow(j, pref, now)), page, hasMore: page * PAGE_SIZE < total && page < MAX_PAGE };
}

/** Pay trace summary, top requirements and the employer link for one job. Null for unknown or closed jobs. */
export async function loadJobPreview(slug: string): Promise<JobPreviewData | null> {
  if (typeof slug !== "string" || slug.length > 200) return null;
  const b = await budget();
  if (b === "busy") throw new BoardBusyError();
  if (b === "limited") return null;
  return (await previewsFor([slug]))[slug] ?? null;
}

export async function suggestJobs(q: string): Promise<BoardSuggestions & { busy?: true }> {
  if (typeof q !== "string" || q.length > SUGGEST_MAX * 2) return { companies: [], titles: [] };
  const b = await budget();
  if (b === "busy") return { companies: [], titles: [], busy: true };
  if (b === "limited") return { companies: [], titles: [] };
  return withAdmin((db) => suggestBoard(db, q));
}
