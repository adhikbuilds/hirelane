import { getFreshestJobs } from "@/lib/queries";
import { formatAge } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { jobs, refreshedAt, boards } = await getFreshestJobs(12);

  return (
    <div className="mx-auto w-full max-w-page px-4 sm:px-8 py-12">
      <h1 className="display max-w-[22ch] text-[40px] sm:text-[56px]">
        Every application is drafted from your resume and sent only when you approve it.
      </h1>

      <section aria-labelledby="ledger-title" className="mt-12">
        <div className="flex items-baseline justify-between border-b-2 border-rule-strong pb-2">
          <h2 id="ledger-title" className="text-[17px] font-semibold">
            Freshest jobs
          </h2>
          {refreshedAt ? (
            <p className="text-[13px] text-ink-2 figure">
              refreshed {formatAge(refreshedAt)} ago from {boards} boards
            </p>
          ) : null}
        </div>

        {jobs.length === 0 ? (
          <div className="border-b border-rule py-8">
            <p className="text-[17px] font-semibold">No jobs ingested yet</p>
            <p className="mt-1 text-ink-2">Pull the first boards from their public APIs with:</p>
            <p className="mt-3 inline-block border border-rule bg-sheet px-3 py-2 text-[15px] font-semibold">
              pnpm ingest:run
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead className="text-[13px] text-ink-3">
              <tr className="border-b border-rule">
                <th className="py-2 font-medium">Fresh</th>
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 font-medium">Where</th>
                <th className="py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="h-11 border-b border-rule">
                  <td className="num">{formatAge(j.postedAt)}</td>
                  <td>
                    {j.title}, {j.company}
                  </td>
                  <td>{j.where}</td>
                  <td>{j.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
