import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { formatAge } from "@/lib/format";
import type { JobDetail } from "@/lib/job-data";
import { EMPLOYMENT, LEVEL, VISA, WORKPLACE } from "./labels";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2.5">
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 break-words text-right font-semibold">{children}</dd>
    </div>
  );
}

export function Facts({ job, where, locations }: { job: JobDetail; where: string | null; locations: string[] }) {
  const fresh = job.postedAt ?? job.firstSeenAt;
  return (
    <section aria-labelledby="where-h" className="grid gap-5 md:grid-cols-2">
      <Card>
        <h2 id="where-h" className="text-[17px] font-extrabold tracking-[-0.01em]">Where and what</h2>
        <dl className="mt-2 divide-y divide-line" data-testid="job-facts">
          <Fact label="Country">{where ?? <span className="font-medium text-ink-3">Not stated</span>}</Fact>
          {locations.length > 0 ? <Fact label="Locations">{locations.join("; ")}</Fact> : null}
          <Fact label="Workplace">
            {job.workplace ? WORKPLACE[job.workplace] ?? job.workplace : <span className="font-medium text-ink-3">Not stated</span>}
            {job.remoteScope === "worldwide" ? ", worldwide" : ""}
          </Fact>
          {job.employment ? <Fact label="Type">{EMPLOYMENT[job.employment] ?? job.employment}</Fact> : null}
          {job.level ? <Fact label="Level">{LEVEL[job.level] ?? job.level}</Fact> : null}
          <Fact label="Visa">{VISA[job.visa] ?? job.visa}</Fact>
        </dl>
      </Card>
      <Card>
        <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">Freshness</h2>
        <dl className="figure mt-2 divide-y divide-line" data-testid="job-freshness">
          <Fact label={job.postedAt ? "Posted" : "First seen"}>
            <time dateTime={fresh.toISOString()}>{formatAge(fresh)} ago</time>
            <span className="block text-[13px] font-normal text-ink-3">{dateFmt.format(fresh)}</span>
          </Fact>
          <Fact label="Last checked">
            <time dateTime={job.lastSeenAt.toISOString()}>{formatAge(job.lastSeenAt)} ago</time>
          </Fact>
          <Fact label="Status">{job.closedAt ? `Closed ${dateFmt.format(job.closedAt)}` : "Open"}</Fact>
        </dl>
        {job.source === "fixture" ? <p className="mt-2 text-[13px] text-ink-3">Recorded fixture data, not a live board pull.</p> : null}
      </Card>
    </section>
  );
}
