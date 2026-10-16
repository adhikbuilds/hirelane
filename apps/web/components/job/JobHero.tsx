import Link from "next/link";
import { Briefcase, ChevronRight, Clock, Globe2, MapPin, ShieldCheck, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { CompanyLogo } from "@/components/brand/CompanyLogo";
import { Chip } from "@/components/ui/Chip";
import { formatAge } from "@/lib/format";
import type { JobDetail } from "@/lib/job-data";
import { safeLogoSrc } from "@/lib/job-view";
import { EMPLOYMENT, LEVEL, VISA, WORKPLACE } from "./labels";

const ic = "size-3.5";

export function JobHero({ job, place }: { job: JobDetail; place: string | null }) {
  const fresh = job.postedAt ?? job.firstSeenAt;
  const chips: { key: string; node: ReactNode }[] = [];
  if (job.workplace) chips.push({ key: "w", node: <Chip tone="lane" icon={<Globe2 aria-hidden className={ic} />}>{WORKPLACE[job.workplace] ?? job.workplace}{job.remoteScope === "worldwide" ? ", worldwide" : ""}</Chip> });
  if (place) chips.push({ key: "p", node: <Chip icon={<MapPin aria-hidden className={ic} />}>{place}</Chip> });
  if (job.employment) chips.push({ key: "e", node: <Chip icon={<Briefcase aria-hidden className={ic} />}>{EMPLOYMENT[job.employment] ?? job.employment}</Chip> });
  if (job.level) chips.push({ key: "l", node: <Chip icon={<TrendingUp aria-hidden className={ic} />}>{LEVEL[job.level] ?? job.level}</Chip> });
  if (job.visa === "yes") chips.push({ key: "v", node: <Chip tone="match" icon={<ShieldCheck aria-hidden className={ic} />}>{VISA.yes}</Chip> });
  chips.push({
    key: "t",
    node: (
      <Chip tone={job.closedAt ? "miss" : "signal"} icon={<Clock aria-hidden className={ic} />}>
        {job.closedAt ? "Closed" : `${job.postedAt ? "Posted" : "First seen"} ${formatAge(fresh)} ago`}
      </Chip>
    ),
  });

  return (
    <div className="hero-mesh relative border-b border-line">
      <div className="stripe-bg absolute inset-0" aria-hidden />
      <div className="relative mx-auto w-full max-w-page px-4 pb-10 pt-8 sm:px-8 sm:pb-14 sm:pt-10">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[14px] font-semibold text-ink-2">
          <Link href="/jobs" className="rounded-md hover:text-lane hover:underline">Jobs</Link>
          <ChevronRight aria-hidden className="size-4 text-ink-3" />
          <Link href={`/company/${job.companySlug}`} className="truncate rounded-md hover:text-lane hover:underline">{job.companyName}</Link>
        </nav>

        <header className="mt-6 flex items-start gap-4 sm:gap-6">
          <div className="rounded-[20px] bg-surface p-1.5 shadow-card">
            <CompanyLogo name={job.companyName} src={safeLogoSrc(job.logoPath)} size={64} />
          </div>
          <div className="min-w-0 pt-1">
            <h1 className="display break-words text-[32px] leading-[36px] sm:text-[48px] sm:leading-[52px]" data-testid="job-title">
              {job.title}
            </h1>
            <p className="mt-2 text-[18px] text-ink-2" data-testid="job-company">
              <Link href={`/company/${job.companySlug}`} className="font-bold text-ink hover:text-lane hover:underline">{job.companyName}</Link>
            </p>
          </div>
        </header>

        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Role details" data-testid="job-chips">
          {chips.map((c) => (
            <li key={c.key}>{c.node}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
