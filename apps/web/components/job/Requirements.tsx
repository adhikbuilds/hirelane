import { Check, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { JobDetail, JobRequirementRow } from "@/lib/job-data";
import { evidenceSlice } from "@/lib/job-view";

function Requirement({ r, text, kind }: { r: JobRequirementRow; text: string | null; kind: "must" | "nice" }) {
  const ev = evidenceSlice(text, r.spanStart, r.spanEnd);
  const meta = [r.category, r.yearsMin !== null ? `${r.yearsMin}+ years` : null].filter(Boolean).join(", ");
  const Icon = kind === "must" ? Check : Sparkles;
  return (
    <li className="py-3.5">
      <div className="flex gap-3">
        <span
          aria-hidden
          className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${kind === "must" ? "bg-lane-50 text-lane" : "bg-signal-50 text-signal-ink"}`}
        >
          <Icon className="size-3.5" strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold leading-6">{r.text}</p>
          <details className="group mt-1">
            <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-md text-[14px] font-semibold text-lane hover:underline">
              Evidence {meta ? <span className="font-medium text-ink-3">({meta})</span> : null}
            </summary>
            {ev ? (
              <p className="mt-2 break-words rounded-r-[10px] border-l-4 border-lane bg-lane-50/60 py-2 pl-3 pr-3 text-[14px] leading-6 text-ink-2">
                {ev.before ? <span>…{ev.before}</span> : null}
                <mark className="rounded-sm bg-signal-50 px-0.5 font-semibold text-ink shadow-[inset_0_-2px_0_var(--color-signal)]">{ev.quote}</mark>
                {ev.after ? <span>{ev.after}…</span> : null}
                <span className="figure mt-1 block text-[13px] text-ink-3">
                  Description, characters {r.spanStart} to {r.spanEnd}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-[14px] text-ink-3">The source text is not available for this requirement.</p>
            )}
          </details>
        </div>
      </div>
    </li>
  );
}

function Group({ id, title, hint, rows, job, kind }: { id: string; title: string; hint: string; rows: JobRequirementRow[]; job: JobDetail; kind: "must" | "nice" }) {
  return (
    <div data-testid={id}>
      <h3 className="flex items-baseline gap-2 text-[17px] font-extrabold tracking-[-0.01em]">
        {title} <span className="figure text-[14px] font-semibold text-ink-3">{rows.length}</span>
      </h3>
      <p className="text-[14px] text-ink-3">{hint}</p>
      {rows.length > 0 ? (
        <ul className="mt-1 divide-y divide-line">
          {rows.map((r, i) => (
            <Requirement key={`${kind}${i}`} r={r} text={job.descriptionText} kind={kind} />
          ))}
        </ul>
      ) : (
        <p className="py-3 text-ink-3">None stated.</p>
      )}
    </div>
  );
}

export function Requirements({ job }: { job: JobDetail }) {
  const must = job.requirements.filter((r) => r.kind === "must");
  const nice = job.requirements.filter((r) => r.kind === "nice");
  return (
    <section aria-labelledby="req-h">
      <h2 id="req-h" className="text-[28px] font-extrabold tracking-[-0.03em]">Requirements</h2>
      <p className="mt-1 text-ink-2">Each one links back to the words in the posting it was read from.</p>
      {job.requirements.length === 0 ? (
        <p className="mt-4 text-ink-3">No requirements could be read from this posting.</p>
      ) : (
        <Card className="mt-5 grid gap-8 lg:grid-cols-2 lg:gap-10">
          <Group id="req-must" kind="must" title="Must have" hint="The posting treats these as required." rows={must} job={job} />
          <Group id="req-nice" kind="nice" title="Nice to have" hint="Stated as a plus, not a gate." rows={nice} job={job} />
        </Card>
      )}
    </section>
  );
}
