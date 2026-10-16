"use server";

import { headers } from "next/headers";
import { withAdmin } from "@hirelane/db";
import { checkRateLimit, clientIp, trustProxyHops } from "@/lib/rate-limit";
import { MAX_PAGE, PAGE_SIZE, parseBoardParams } from "@/components/board/url-state";
import { toBoardRow, type BoardRow } from "@/components/board/row-model";
import { SUGGEST_MAX, previewsFor, searchJobs, suggestBoard, type BoardSuggestions, type JobPreviewData } from "@/lib/queries/jobs";

const MAX_QS = 600;
/** Board actions run on scroll, hover and keystrokes, so the budget is wider than the public API's, but still bounded. */
const ACTION_LIMIT = 300;
const ACTION_WINDOW_SECONDS = 60;

/** Per-IP budget shared by the three board actions. Fails open if the limiter itself errors, like the public API. */
async function withinBudget(): Promise<boolean> {
  try {
    const ip = clientIp(await headers(), { hops: trustProxyHops(), socketAddress: null });
    const r = await withAdmin((c) =>
      checkRateLimit(c, `board-actions:${ip}`, { limit: ACTION_LIMIT, windowSeconds: ACTION_WINDOW_SECONDS, prune: Math.random() < 0.01 }),
    );
    return r.allowed;
  } catch {
    return true;
  }
}

export type MoreRows = { rows: BoardRow[]; page: number; hasMore: boolean };

/** One more page of the board for the same URL state. Same cached query as the server render, so counts never disagree. */
export async function loadMoreJobs(qs: string, page: number): Promise<MoreRows> {
  if (typeof qs !== "string" || qs.length > MAX_QS || !Number.isInteger(page) || page < 2 || page > MAX_PAGE) {
    return { rows: [], page: 1, hasMore: false };
  }
  if (!(await withinBudget())) return { rows: [], page: 1, hasMore: false };
  const query = { ...parseBoardParams(new URLSearchParams(qs)), page, pageSize: PAGE_SIZE };
  const { total, jobs } = await searchJobs(query);
  const pref = query.filter.country === "IN" ? "INR" : "USD";
  const now = new Date();
  return { rows: jobs.map((j) => toBoardRow(j, pref, now)), page, hasMore: page * PAGE_SIZE < total && page < MAX_PAGE };
}

/** Pay trace summary, top requirements and the employer link for one job. Null for unknown or closed jobs. */
export async function loadJobPreview(slug: string): Promise<JobPreviewData | null> {
  if (typeof slug !== "string" || slug.length > 200) return null;
  if (!(await withinBudget())) return null;
  return (await previewsFor([slug]))[slug] ?? null;
}

export async function suggestJobs(q: string): Promise<BoardSuggestions> {
  if (typeof q !== "string" || q.length > SUGGEST_MAX * 2) return { companies: [], titles: [] };
  if (!(await withinBudget())) return { companies: [], titles: [] };
  return withAdmin((db) => suggestBoard(db, q));
}
