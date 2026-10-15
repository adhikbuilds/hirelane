import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ledger } from "@/components/board/ledger";
import { SourceBadge } from "../../source-badge";
import { formatCount } from "@/lib/format";
import { isJobSlug } from "@/lib/job-view";
import { getCompany, searchJobs } from "@/lib/queries/jobs";

export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug: string }> };
const ROLE_LIMIT = 100;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = isJobSlug(slug) ? await getCompany(slug) : null;
  if (!c) return { title: "Company not found", robots: { index: false } };
  return {
    title: `${c.name} jobs`,
    alternates: { canonical: `/company/${c.slug}` },
    robots: c.open === 0 ? { index: false, follow: true } : undefined,
  };
}

export default async function CompanyPage({ params }: Props) {
  const { slug } = await params;
  if (!isJobSlug(slug)) notFound();
  const company = await getCompany(slug);
  if (!company) notFound();
  const { jobs, total } = await searchJobs({ filter: { company: slug }, page: 1, pageSize: ROLE_LIMIT, sort: "fresh" });

  return (
    <div className="mx-auto w-full max-w-page px-4 py-8 sm:px-8">
      <p className="text-[13px]">
        <Link href="/companies" className="text-lane">Companies</Link>
      </p>
      <div className="mt-3 flex items-end justify-between gap-4 border-b-2 border-rule-strong pb-2">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="display min-w-0 break-words text-[40px]" data-testid="company-name">{company.name}</h1>
        </div>
        <p className="figure flex shrink-0 items-center gap-2 text-[13px] text-ink-2" data-testid="company-count">
          {company.ats.map((a) => (
            <SourceBadge key={a} ats={a} />
          ))}
          {formatCount(total)} open
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="border-b border-rule py-8" data-testid="company-empty">
          <p className="text-[17px] font-semibold">No open roles right now</p>
          <p className="mt-1 text-ink-2">This company&apos;s board had no open postings the last time it was checked.</p>
          <p className="mt-3">
            <Link href="/jobs" className="font-semibold text-lane underline">Browse all jobs</Link>
          </p>
        </div>
      ) : (
        <>
          <Ledger jobs={jobs} pref="USD" showCompany={false} now={new Date()} testId="company-ledger" />
          {total > jobs.length ? (
            <p className="figure py-4 text-[13px] text-ink-2">
              Showing the {formatCount(jobs.length)} freshest of {formatCount(total)} open roles.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
