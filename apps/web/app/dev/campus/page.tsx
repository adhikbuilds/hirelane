import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampusConsole } from "@/components/campus/Console";
import { SAMPLE_CAMPUS } from "@/lib/sample/campus";

export const metadata: Metadata = { title: "Placement console preview", robots: { index: false, follow: false } };

/** Dev-only: the placement console on a labelled sample cohort, for G4 placement-cell conversations. */
export default function CampusPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CampusConsole data={SAMPLE_CAMPUS} />;
}
