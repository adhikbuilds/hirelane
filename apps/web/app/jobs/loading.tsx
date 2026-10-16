import { RowSkeletons } from "@/components/board/job-row";

/** Shown while a navigation to /jobs resolves. Deliberately has no count: the number is only real once the query returns. */
export default function Loading() {
  return (
    <>
      <section className="hero-mesh stripe-bg border-b border-line">
        <div className="mx-auto w-full max-w-page px-4 pb-8 pt-9 sm:px-8 sm:pb-10 sm:pt-12">
          <p className="text-[13px] font-bold uppercase tracking-[0.1em] text-lane">Live from career sites</p>
          <h1 className="display mt-1 text-[40px] leading-[44px] sm:text-[52px] sm:leading-[56px]">Jobs</h1>
          <div className="skeleton mt-6 h-14 max-w-3xl rounded-[16px]" />
        </div>
      </section>
      <div className="mx-auto w-full max-w-page px-4 py-5 sm:px-8">
        <div className="skeleton h-9 w-full max-w-xl rounded-full" />
        <div role="status" aria-busy="true" className="mt-4">
          <span className="sr-only">Loading jobs</span>
          <ul className="overflow-hidden rounded-[16px] border border-line bg-surface shadow-card">
            <RowSkeletons n={8} />
          </ul>
        </div>
      </div>
    </>
  );
}
