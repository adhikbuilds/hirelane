import { devPagesOpen } from "@/lib/dev-gate";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampusDash, type DashBy } from "@/components/campus/Dash";
import { SAMPLE_CAMPUS } from "@/lib/sample/campus";

export const metadata: Metadata = { title: "Placement console", robots: { index: false, follow: false } };

/** Console overview in the dark analytics register, on a labelled sample cohort. 404 in production until wired. */
export default async function CampusPreview({ searchParams }: { searchParams: Promise<{ by?: string }> }) {
  if (!devPagesOpen()) notFound();
  const { by } = await searchParams;
  const view: DashBy = by === "blocker" || by === "drive" ? by : "programme";
  return <CampusDash data={SAMPLE_CAMPUS} by={view} />;
}
