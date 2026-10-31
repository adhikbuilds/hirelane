import type { Metadata } from "next";
import { CampusDash, type DashBy } from "@/components/campus/Dash";
import { loadCampusOverview } from "@/lib/adapters/load";
import { SAMPLE_CAMPUS } from "@/lib/sample/campus";

export const metadata: Metadata = { title: "Placement console", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Console overview in the dark analytics register. Development only until CampusDash stops hard-coding its weekly
 * chart, programme split and Act list (production answers 404, as before). A signed-in TPO sees their real cohort.
 */
export default async function CampusPage({ searchParams }: { searchParams: Promise<{ by?: string }> }) {
  const [{ by }, s] = await Promise.all([searchParams, loadCampusOverview()]);
  const view: DashBy = by === "blocker" || by === "drive" ? by : "programme";
  return <CampusDash data={s.source === "real" ? s.data.overview : SAMPLE_CAMPUS} by={view} />;
}
