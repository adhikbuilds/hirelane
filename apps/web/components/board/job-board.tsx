"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { loadJobPreview, loadMoreJobs } from "../../app/jobs/actions";
import type { JobPreviewData } from "../../lib/queries/jobs";
import { JobRow, RowSkeletons } from "./job-row";
import { PreviewPanel } from "./preview-panel";
import type { BoardRow } from "./row-model";

const HOVER_INTENT_MS = 70;
const KEYBOARD_GRACE_MS = 600;
const WIDE = "(min-width: 80rem)";

/** Canonical /jobs URL for a page: filters, then page, then sort (the order `serializeBoard` writes). */
export function pageHref(qs: string, page: number): string {
  const sp = new URLSearchParams(qs);
  const sort = sp.get("sort");
  sp.delete("page");
  sp.delete("sort");
  if (page > 1) sp.set("page", String(page));
  if (sort) sp.set("sort", sort);
  const out = sp.toString();
  return out ? `/jobs?${out}` : "/jobs";
}

export type JobBoardProps = {
  initialRows: BoardRow[];
  /** Preview data already known on the server, keyed by slug (the first row's). */
  initialPreviews: Record<string, JobPreviewData | null>;
  total: number;
  /** The page the server rendered; later pages append. */
  page: number;
  hasMore: boolean;
  /** Canonical query string without `page`, for the next-page request and link. */
  qs: string;
  pageSize: number;
};

/** The list, the preview panel and infinite load. Mount it with `key={qs}`: a new filter is a new board. */
export function JobBoard({ initialRows, initialPreviews, total, page, hasMore: initialHasMore, qs, pageSize }: JobBoardProps) {
  const [rows, setRows] = useState(initialRows);
  const [lastPage, setLastPage] = useState(page);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, startLoad] = useTransition();
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const [active, setActive] = useState<string | null>(initialRows[0]?.slug ?? null);
  const [previews, setPreviews] = useState(initialPreviews);
  const wide = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const asked = useRef(new Set<string>(Object.keys(initialPreviews)));

  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const sync = () => {
      wide.current = mq.matches;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const lastFocus = useRef(0);
  const activate = useCallback((slug: string, how: "hover" | "focus") => {
    clearTimeout(timer.current);
    if (how === "focus") {
      lastFocus.current = Date.now();
      setActive(slug);
    } else if (Date.now() - lastFocus.current > KEYBOARD_GRACE_MS) {
      // Keyboard scrolling slides rows under a resting pointer; that must not steal the preview.
      timer.current = setTimeout(() => setActive(slug), HOVER_INTENT_MS);
    }
  }, []);

  // Fetch the active job's preview once. Below xl the panel is hidden, so nothing is fetched.
  useEffect(() => {
    if (!active || !wide.current || asked.current.has(active)) return;
    asked.current.add(active);
    loadJobPreview(active)
      .then((d) => setPreviews((p) => ({ ...p, [active]: d })))
      .catch(() => asked.current.delete(active));
  }, [active]);

  const more = useCallback(() => {
    if (busy.current || !hasMore) return;
    busy.current = true;
    setFailed(false);
    startLoad(async () => {
      try {
        const res = await loadMoreJobs(qs, lastPage + 1);
        if (res.busy) {
          setFailed(true);
          return;
        }
        setRows((cur) => {
          const seen = new Set(cur.map((r) => r.slug));
          return [...cur, ...res.rows.filter((r) => !seen.has(r.slug))];
        });
        setLastPage(res.page > lastPage ? res.page : lastPage);
        setHasMore(res.hasMore);
      } catch {
        setFailed(true);
      } finally {
        busy.current = false;
      }
    });
  }, [hasMore, lastPage, qs]);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || failed) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && more(), { rootMargin: "480px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, failed, more, rows.length]);

  const activeRow = rows.find((r) => r.slug === active) ?? null;
  const known = active ? active in previews : false;
  const data = active ? (previews[active] ?? null) : null;
  const first = (page - 1) * pageSize + 1;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">
        <ul
          data-testid="jobs-ledger"
          aria-label="Open jobs"
          className="overflow-hidden rounded-[16px] border border-line bg-surface shadow-card"
        >
          {rows.map((r) => (
            <JobRow key={r.slug} row={r} active={r.slug === active} onActivate={activate} />
          ))}
          {loadingMore ? <RowSkeletons n={4} /> : null}
        </ul>

        <div ref={sentinel} aria-hidden="true" />
        <nav aria-label="Pages" className="flex flex-col items-center gap-3 py-6 text-[14px]">
          <p className="figure text-ink-2" data-testid="jobs-shown" role="status">
            Showing {first.toLocaleString("en-US")} to {(first + rows.length - 1).toLocaleString("en-US")} of {total.toLocaleString("en-US")}
          </p>
          <div className="flex items-center gap-4">
            {page > 1 ? (
              <Link href={pageHref(qs, page - 1)} rel="prev" className="font-semibold text-lane hover:underline">
                Previous page
              </Link>
            ) : null}
            {hasMore ? (
              <a
                href={pageHref(qs, lastPage + 1)}
                rel="next"
                data-testid="jobs-load-more"
                aria-busy={loadingMore}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  more();
                }}
                className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-line bg-surface px-5 text-[15px] font-bold text-ink shadow-control hover:border-lane/40 hover:bg-lane-50"
              >
                {loadingMore ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
                {loadingMore ? "Loading" : failed ? "Could not load, try again" : "Load more jobs"}
              </a>
            ) : null}
          </div>
        </nav>
      </div>

      <aside aria-label="Job preview" className="hidden xl:sticky xl:top-4 xl:block xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto xl:rounded-[16px]">
        <PreviewPanel row={activeRow} data={data} loading={Boolean(active) && !known} />
      </aside>
    </div>
  );
}
