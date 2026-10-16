import { Card } from "@/components/ui/Card";
import type { JobDetail } from "@/lib/job-data";
import { traceRows } from "@/lib/job-view";

export function PayTrace({ job }: { job: JobDetail }) {
  const rows = traceRows(job.salary.trace);
  if (rows.length === 0) return null;
  return (
    <Card padded={false} data-testid="salary-trace" className="overflow-hidden">
      <details>
        <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-5 py-4 text-[17px] font-extrabold tracking-[-0.01em] hover:bg-lane-50/50 sm:px-6">
          <span>How the pay was worked out <span className="figure text-[14px] font-semibold text-ink-3">{rows.length} steps</span></span>
          <span aria-hidden className="text-lane">+</span>
        </summary>
        <ol className="border-t border-line">
          {rows.map((r, i) => (
            <li key={`${r.seq}-${i}`} className="flex gap-3 border-b border-line px-5 py-3 last:border-b-0 sm:px-6" data-step={r.group}>
              <span className="figure w-4 shrink-0 text-[13px] text-ink-3">{i + 1}</span>
              <span className="w-16 shrink-0 text-[13px] font-bold text-lane">{r.group}</span>
              <span className="min-w-0 break-words text-[14px]">{r.label}</span>
            </li>
          ))}
        </ol>
      </details>
    </Card>
  );
}
