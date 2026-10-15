import type { Metadata } from "next";
import Link from "next/link";
import { withAdmin } from "@hirelane/db";
import { formatCount } from "@/lib/format";
import { facetCounts } from "@/lib/lists-data";
import { groupPublished, type ListKind } from "@/lib/lists";
import { appOrigin } from "@/lib/queries/jobs";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Job lists",
  description: "Curated lists of open jobs from public company boards, with live counts.",
  alternates: { canonical: `${appOrigin()}/lists` },
};

const SECTIONS: { kind: ListKind; title: string; note: string }[] = [
  { kind: "role-country", title: "By role and country", note: "Jobs that name the country in their location." },
  { kind: "remote-role", title: "Remote by role", note: "Jobs open to remote work, in any country." },
  { kind: "salary-role", title: "With a posted salary", note: "Jobs whose posting states pay. Nothing is estimated." },
];

export default async function ListsIndex() {
  const counts = await withAdmin((db) => facetCounts(db));
  const groups = groupPublished(counts);
  const total = SECTIONS.reduce((s, x) => s + groups[x.kind].length, 0);

  return (
    <div className="mx-auto w-full max-w-page px-4 sm:px-8 py-8">
      <div className="flex items-baseline justify-between border-b-2 border-rule-strong pb-2">
        <h1 className="display text-[40px]">Job lists</h1>
        <p className="figure text-[13px] text-ink-2" data-testid="lists-count">
          {formatCount(total)} lists
        </p>
      </div>

      {total === 0 ? (
        <div className="border-b border-rule py-8" data-testid="lists-empty">
          <p className="text-[17px] font-semibold">No lists have 20 open jobs yet</p>
          <p className="mt-1 text-ink-2">
            A list appears here once at least 20 open jobs match it. <Link href="/jobs" className="text-lane underline">Browse all jobs</Link>.
          </p>
        </div>
      ) : (
        SECTIONS.filter((s) => groups[s.kind].length > 0).map((s) => (
          <section key={s.kind} aria-labelledby={`sec-${s.kind}`} className="mt-8" data-testid={`lists-${s.kind}`}>
            <div className="flex items-baseline justify-between border-b border-rule-strong pb-2">
              <h2 id={`sec-${s.kind}`} className="text-[17px] font-semibold">
                {s.title}
              </h2>
              <p className="text-[13px] text-ink-3">{s.note}</p>
            </div>
            <ul>
              {groups[s.kind].map(({ def, n }) => (
                <li key={def.slug} className="flex h-11 items-center justify-between border-b border-rule">
                  <Link href={`/lists/${def.slug}`} className="font-medium hover:text-lane hover:underline">
                    {def.name}
                  </Link>
                  <span className="num text-ink-2">{formatCount(n)} open</span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
