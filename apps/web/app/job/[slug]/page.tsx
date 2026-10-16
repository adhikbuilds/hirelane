import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildJobPostingLd, jsonLdScript } from "@/components/board/job-posting-ld";
import { dedupeLocations } from "@/components/board/locations";
import { Description } from "@/components/job/Description";
import { Facts } from "@/components/job/Facts";
import { JobHero } from "@/components/job/JobHero";
import { MobileApplyBar } from "@/components/job/MobileApplyBar";
import { PayTrace } from "@/components/job/PayTrace";
import { Requirements } from "@/components/job/Requirements";
import { SideCard } from "@/components/job/SideCard";
import { similarJobs } from "@/components/job/similar";
import { SimilarRoles } from "@/components/job/SimilarRoles";
import { Skills } from "@/components/job/Skills";
import { appOrigin } from "@/lib/queries/jobs";
import { getJobBySlug } from "@/lib/job-data";
import { isJobSlug, safeHttpUrl } from "@/lib/job-view";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const job = isJobSlug(slug) ? await getJobBySlug(slug) : null;
  if (!job) return { title: "Job not found", robots: { index: false } };
  return {
    title: `${job.title} at ${job.companyName}`,
    robots: job.closedAt ? { index: false, follow: true } : undefined,
    alternates: { canonical: `/job/${job.slug}` },
  };
}

export default async function JobPage({ params }: Props) {
  const { slug } = await params;
  if (!isJobSlug(slug)) notFound();
  const job = await getJobBySlug(slug);
  if (!job) notFound();

  const where = job.countries.length > 0 ? job.countries.join(", ") : null;
  const apply = safeHttpUrl(job.applyUrl);
  const locations = dedupeLocations(job.locations);
  const ld = buildJobPostingLd(job, appOrigin());
  const similar = await similarJobs(job.slug);

  return (
    <>
      {ld ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }} /> : null}
      <JobHero job={job} place={locations[0] ?? where} />

      <div className="mx-auto grid w-full max-w-page gap-10 px-4 pb-8 pt-8 sm:px-8 sm:pt-10 lg:grid-cols-12 lg:gap-12">
        <aside className="order-first min-w-0 lg:order-last lg:col-span-4">
          <div className="lg:sticky lg:top-24">
            <SideCard job={job} apply={apply} />
          </div>
        </aside>

        <div className="min-w-0 space-y-12 lg:col-span-8">
          <Skills skills={job.skills} />
          <Requirements job={job} />
          <Description text={job.descriptionText} />
          <PayTrace job={job} />
          <Facts job={job} where={where} locations={locations} />
        </div>
      </div>

      <SimilarRoles jobs={similar} roleLabel={`Open roles in the same field${where ? `, in ${job.countries[0]}` : ""}, freshest first.`} />
      {apply && !job.closedAt ? <MobileApplyBar slug={job.slug} apply={apply} title={job.title} /> : null}
      <div className="h-20 lg:hidden" aria-hidden />
    </>
  );
}
