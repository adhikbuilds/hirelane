import type { Metadata } from "next";
import Link from "next/link";
import { Logo16 } from "@/components/board/logo";
import { SourceBadge } from "../source-badge";
import { formatCount } from "@/lib/format";
import { safeLogoSrc } from "@/lib/job-view";
import { listCompanies } from "@/lib/queries/jobs";

export const revalidate = 300;
export const metadata: Metadata = { title: "Companies", alternates: { canonical: "/companies" } };

export default async function CompaniesPage() {
  const companies = await listCompanies();
  const open = companies.reduce((n, c) => n + c.open, 0);

  return (
    <div className="mx-auto w-full max-w-page px-4 py-8 sm:px-8">
      <div className="flex items-baseline justify-between border-b-2 border-rule-strong pb-2">
        <h1 className="display text-[40px]">Companies</h1>
        <p className="figure text-[13px] text-ink-2" data-testid="companies-count">
          {formatCount(companies.length)} hiring, {formatCount(open)} open roles
        </p>
      </div>

      {companies.length === 0 ? (
        <div className="border-b border-rule py-8" data-testid="companies-empty">
          <p className="text-[17px] font-semibold">No companies with open roles</p>
          <p className="mt-1 text-ink-2">Companies appear here once their boards have been ingested.</p>
        </div>
      ) : (
        <table className="mt-2 w-full table-fixed text-left" data-testid="companies-ledger">
          <thead className="text-[13px] text-ink-2">
            <tr className="border-b border-rule">
              <th className="py-2 pr-3 font-medium">Company</th>
              <th className="w-28 py-2 pr-3 text-right font-medium">Open roles</th>
              <th className="w-24 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.slug} className="h-11 border-b border-rule hover:bg-lane-soft focus-within:bg-lane-soft">
                <td className="min-w-0 pr-3">
                  <Link href={`/company/${c.slug}`} className="flex items-center gap-2 truncate text-[15px] font-medium hover:text-lane hover:underline">
                    <Logo16 name={c.name} src={safeLogoSrc(c.logoPath)} />
                    <span className="truncate">{c.name}</span>
                  </Link>
                </td>
                <td className="figure pr-3 text-right">{formatCount(c.open)}</td>
                <td>
                  <span className="flex gap-1">
                    {c.ats.map((a) => (
                      <SourceBadge key={a} ats={a} />
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
