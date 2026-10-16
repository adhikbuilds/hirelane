import { Card } from "@/components/ui/Card";
import type { JobDetail } from "@/lib/job-data";
import { formatSalary } from "@/lib/job-view";
import { formatAge } from "@/lib/format";
import { ApplyActions } from "./ApplyActions";
import { SALARY_SOURCE } from "./labels";

export function Equivalents({ job }: { job: JobDetail }) {
  const s = job.salary;
  const usd = s.currency === "USD" ? null : formatSalary({ minMinor: s.annualUsdMin, maxMinor: s.annualUsdMax, currency: "USD", period: "year" });
  const inr = s.currency === "INR" ? null : formatSalary({ minMinor: s.annualInrMin, maxMinor: s.annualInrMax, currency: "INR", period: "year" });
  if (!usd && !inr) return null;
  return (
    <p className="figure mt-2 text-[14px] text-ink-2" data-testid="salary-equivalents">
      About {[usd, inr].filter(Boolean).join(" or ")}
      {s.fxDate ? `, at the ${s.fxDate} rates` : ""}
    </p>
  );
}

/** The sticky apply card: pay, the external apply link and a local Save. */
export function SideCard({ job, apply }: { job: JobDetail; apply: string | null }) {
  const s = job.salary;
  const headline = formatSalary({ minMinor: s.minMinor, maxMinor: s.maxMinor, currency: s.currency, period: s.period });
  return (
    <Card data-testid="apply-card" className="shadow-pop">
      <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-ink-3">Pay</p>
      {headline ? (
        <>
          <p className="display figure mt-1 text-[34px] leading-[38px] text-lane" data-testid="salary">{headline}</p>
          <p className="mt-2 text-[14px] text-ink-2">
            {s.kind === "ote" ? "On-target earnings, not base pay. " : ""}
            {s.source ? `Read from ${SALARY_SOURCE[s.source] ?? s.source}.` : ""}
          </p>
          <Equivalents job={job} />
        </>
      ) : (
        <p className="mt-1 text-[20px] font-bold text-ink-2" data-testid="salary-none">Not stated in the posting</p>
      )}
      <ApplyActions slug={job.slug} apply={apply} closed={Boolean(job.closedAt)} className="mt-5" />
      <p className="mt-4 border-t border-line pt-3 text-[13px] text-ink-3">
        Opens the employer&apos;s own form. Last checked <time dateTime={job.lastSeenAt.toISOString()}>{formatAge(job.lastSeenAt)} ago</time>.
      </p>
    </Card>
  );
}
