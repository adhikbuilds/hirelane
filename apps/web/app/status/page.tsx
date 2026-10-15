import type { Metadata } from "next";
import { SourceBadge } from "@/app/source-badge";
import { getStatusData } from "@/components/landing/data";
import { formatAgeLong, freshnessState, statusSummary, type Freshness } from "@/components/landing/model";
import { PageShell, Section } from "@/components/landing/page-shell";
import { formatCount } from "@/lib/format";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Status",
  description: "How fresh the job ledger is, from the ingest run log.",
};

const LABEL: Record<Freshness, string> = {
  fresh: "On schedule",
  late: "Late",
  stale: "Stale",
  none: "No data yet",
};
const TONE: Record<Freshness, string> = {
  fresh: "text-lane",
  late: "text-ink",
  stale: "text-stop",
  none: "text-ink-2",
};

export default async function Status() {
  const d = await getStatusData();
  const now = new Date();
  const state = freshnessState(d.lastGoodAt, now);

  return (
    <PageShell title="Ingest status." lede="Computed from the ingest run log each time this page is built, at most five minutes ago.">
      <Section id="now" title="Right now">
        <p className={`mt-4 text-[28px] font-extrabold ${TONE[state]}`} data-testid="status-state">
          {LABEL[state]}
        </p>
        <p className="mt-1 text-ink-2">
          {d.lastGoodAt ? `Last successful run finished ${formatAgeLong(d.lastGoodAt, now)} ago. ` : ""}
          {statusSummary(state, d.boardsOk, d.boardsFailed)}
        </p>
        <p className="figure mt-2 text-[13px] text-ink-3">
          As of <time dateTime={now.toISOString()}>{now.toISOString().replace("T", " ").slice(0, 16)} UTC</time>
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 border-t border-rule sm:grid-cols-3">
          {[
            ["Open jobs", formatCount(d.openJobs)],
            ["Open postings", formatCount(d.openPostings)],
            ["Boards enabled", formatCount(d.perSource.reduce((a, s) => a + s.boards, 0))],
          ].map(([k, v]) => (
            <div key={k} className="border-b border-rule py-3">
              <dt className="text-[13px] text-ink-3">{k}</dt>
              <dd className="figure font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="sources" title="By source">
        <table className="w-full text-left">
          <thead className="text-[13px] text-ink-3">
            <tr className="border-b border-rule">
              <th className="py-2 pr-4 font-medium">Source</th>
              <th className="py-2 pr-4 font-medium">Boards</th>
              <th className="py-2 font-medium">Open postings</th>
            </tr>
          </thead>
          <tbody>
            {d.perSource.map((s) => (
              <tr key={s.ats} className="h-11 border-b border-rule">
                <td className="pr-4"><SourceBadge ats={s.ats} /> <span className="ml-2">{s.ats}</span></td>
                <td className="num pr-4">{formatCount(s.boards)}</td>
                <td className="num">{formatCount(s.openPostings)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="runs" title="Recent runs">
        {d.runs.length === 0 ? (
          <p className="mt-3 text-ink-2">No ingest run has been recorded.</p>
        ) : (
          <table className="w-full text-left" data-testid="status-runs">
            <thead className="text-[13px] text-ink-3">
              <tr className="border-b border-rule">
                <th className="py-2 pr-4 font-medium">Started</th>
                <th className="py-2 pr-4 font-medium">Result</th>
                <th className="py-2 pr-4 font-medium">Boards ok</th>
                <th className="py-2 pr-4 font-medium">Failed</th>
                <th className="hidden py-2 pr-4 font-medium sm:table-cell">New</th>
                <th className="hidden py-2 font-medium sm:table-cell">Closed</th>
              </tr>
            </thead>
            <tbody>
              {d.runs.map((r) => (
                <tr key={r.id} className="h-11 border-b border-rule">
                  <td className="num pr-4">
                    <time dateTime={r.startedAt.toISOString()}>{formatAgeLong(r.startedAt, now)} ago</time>
                  </td>
                  <td className={`pr-4 ${r.status === "ok" ? "text-lane" : r.status === "failed" ? "text-stop" : ""}`}>{r.status}</td>
                  <td className="num pr-4">{formatCount(r.boardsOk)}</td>
                  <td className="num pr-4">{formatCount(r.boardsFailed)}</td>
                  <td className="num hidden pr-4 sm:table-cell">{formatCount(r.postingsNew)}</td>
                  <td className="num hidden sm:table-cell">{formatCount(r.postingsClosed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </PageShell>
  );
}
