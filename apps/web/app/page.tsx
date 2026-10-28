import type { Metadata } from "next";
import { MainLanding, type SiteCounts } from "@/components/landing/Main";
import { getLandingSnapshot } from "@/lib/queries/landing";

export const metadata: Metadata = {
  title: { absolute: "Hirelane: off-campus jobs, matched to your marks" },
  description: "Hirelane reads company career pages, checks every role against your marks and gets your application ready. You press submit. Free for students.",
};

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h}h ago` : null; // older than 2 days: say nothing rather than advertise stale data
}

/** Live counts come from the job index; if it's unreachable the page renders without them (never invented). */
async function loadCounts(): Promise<SiteCounts> {
  try {
    const snap = await getLandingSnapshot();
    const c = snap.counts;
    return { openJobs: c.openJobs, companies: c.companies, withSalary: c.withSalary, readAgo: ago(c.asOf) };
  } catch {
    return null;
  }
}

export default async function Home() {
  return <MainLanding counts={await loadCounts()} />;
}
