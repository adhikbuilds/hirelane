import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { SourceBadge } from "../../source-badge";
import { formatAge, formatCount } from "@/lib/format";
import { getIngestOverview } from "@/lib/ingest-data";
import { OPS_COOKIE, opsAccess } from "@/lib/ops-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ingest", robots: { index: false, follow: false } };

const stamp = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

export default async function OpsIngestPage() {
  const access = opsAccess({
    configured: process.env["HIRELANE_OPS_TOKEN"],
    header: (await headers()).get("x-ops-token"),
    cookie: (await cookies()).get(OPS_COOKIE)?.value ?? null,
  });
  if (access !== "ok") notFound();

  const { runs, perSource, boardRuns, openPostings } = await getIngestOverview();
  const latest = runs[0];

  return (
    <div className="mx-auto w-full max-w-page px-4 sm:px-8 py-8">
      <div className="flex items-baseline justify-between border-b-2 border-rule-strong pb-2">
        <h1 className="display text-[40px]">Ingest</h1>
        <p className="figure text-[13px] text-ink-2">{formatCount(openPostings)} open postings</p>
      </div>

      {!latest ? (
        <div className="border-b border-rule py-8" data-testid="ops-empty">
          <p className="text-[17px] font-semibold">No ingest runs yet</p>
          <p className="mt-1 text-ink-2">Start one with:</p>
          <p className="mt-3 inline-block border border-rule bg-sheet px-3 py-2 text-[15px] font-semibold">
            pnpm ingest:run --mode fixture
          </p>
        </div>
      ) : (
        <>
          <section aria-labelledby="runs-title" className="mt-8">
            <h2 id="runs-title" className="border-b border-rule pb-2 text-[17px] font-semibold">
              Last runs
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left" data-testid="ops-runs">
                <thead className="text-[13px] text-ink-3">
                  <tr className="border-b border-rule">
                    <th className="py-2 pr-3 font-medium">Started</th>
                    <th className="py-2 pr-3 font-medium">Age</th>
                    <th className="py-2 pr-3 font-medium">Mode</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 text-right font-medium">Boards ok</th>
                    <th className="py-2 pr-3 text-right font-medium">Failed</th>
                    <th className="py-2 pr-3 text-right font-medium">New</th>
                    <th className="py-2 pr-3 text-right font-medium">Changed</th>
                    <th className="py-2 text-right font-medium">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="h-11 border-b border-rule">
                      <td className="num pr-3">{stamp(r.startedAt)}</td>
                      <td className="num pr-3 text-ink-2">{formatAge(r.startedAt)}</td>
                      <td className="pr-3">
                        {r.mode} ({r.trigger})
                      </td>
                      <td className={`pr-3 font-medium ${r.status === "failed" ? "text-stop" : ""}`}>{r.status}</td>
                      <td className="num pr-3 text-right">{formatCount(r.boardsOk)}</td>
                      <td className={`num pr-3 text-right ${r.boardsFailed > 0 ? "font-semibold text-stop" : ""}`}>
                        {formatCount(r.boardsFailed)}
                      </td>
                      <td className="num pr-3 text-right">{formatCount(r.postingsNew)}</td>
                      <td className="num pr-3 text-right">{formatCount(r.postingsChanged)}</td>
                      <td className="num text-right">{formatCount(r.postingsClosed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="sources-title" className="mt-12">
            <h2 id="sources-title" className="border-b border-rule pb-2 text-[17px] font-semibold">
              Latest run by source
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left" data-testid="ops-sources">
                <thead className="text-[13px] text-ink-3">
                  <tr className="border-b border-rule">
                    <th className="py-2 pr-3 font-medium">Source</th>
                    <th className="py-2 pr-3 text-right font-medium">Boards</th>
                    <th className="py-2 pr-3 text-right font-medium">Failed</th>
                    <th className="py-2 pr-3 text-right font-medium">Fetched</th>
                    <th className="py-2 pr-3 text-right font-medium">New</th>
                    <th className="py-2 pr-3 text-right font-medium">Changed</th>
                    <th className="py-2 pr-3 text-right font-medium">Unchanged</th>
                    <th className="py-2 text-right font-medium">Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {perSource.map((s) => (
                    <tr key={s.ats} className="h-11 border-b border-rule">
                      <td className="pr-3">
                        <SourceBadge ats={s.ats} />
                      </td>
                      <td className="num pr-3 text-right">{formatCount(s.boards)}</td>
                      <td className={`num pr-3 text-right ${s.failed > 0 ? "font-semibold text-stop" : ""}`}>
                        {formatCount(s.failed)}
                      </td>
                      <td className="num pr-3 text-right">{formatCount(s.fetched)}</td>
                      <td className="num pr-3 text-right">{formatCount(s.new)}</td>
                      <td className="num pr-3 text-right">{formatCount(s.changed)}</td>
                      <td className="num pr-3 text-right">{formatCount(s.unchanged)}</td>
                      <td className="num text-right">{formatCount(s.closed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="boards-title" className="mt-12">
            <h2 id="boards-title" className="border-b border-rule pb-2 text-[17px] font-semibold">
              Boards in the latest run (failures first, up to 200)
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left" data-testid="ops-boards">
                <thead className="text-[13px] text-ink-3">
                  <tr className="border-b border-rule">
                    <th className="py-2 pr-3 font-medium">Company</th>
                    <th className="py-2 pr-3 font-medium">Source</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 text-right font-medium">HTTP</th>
                    <th className="py-2 pr-3 text-right font-medium">Fetched</th>
                    <th className="py-2 pr-3 text-right font-medium">New</th>
                    <th className="py-2 pr-3 text-right font-medium">Changed</th>
                    <th className="py-2 pr-3 text-right font-medium">Closed</th>
                    <th className="py-2 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {boardRuns.map((b) => (
                    <tr key={`${b.ats}:${b.company}`} className="h-11 border-b border-rule">
                      <td className="pr-3 font-medium">
                        {b.company}
                        {b.errorText ? <span className="block text-[13px] font-normal text-stop">{b.errorText}</span> : null}
                      </td>
                      <td className="pr-3">
                        <SourceBadge ats={b.ats} />
                      </td>
                      <td className={`pr-3 ${b.status === "ok" ? "" : "font-semibold text-stop"}`}>{b.status}</td>
                      <td className="num pr-3 text-right">{b.httpStatus ?? "none"}</td>
                      <td className="num pr-3 text-right">{formatCount(b.fetched)}</td>
                      <td className="num pr-3 text-right">{formatCount(b.new)}</td>
                      <td className="num pr-3 text-right">{formatCount(b.changed)}</td>
                      <td className="num pr-3 text-right">{formatCount(b.closed)}</td>
                      <td className="num text-right">{formatCount(b.durationMs)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
