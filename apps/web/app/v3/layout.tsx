import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { devPagesOpen } from "@/lib/dev-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The v3 landing still has the drag-to-pass stack, which the product no longer ships. It is a preview only: 404 in production unless HIRELANE_SAMPLES=1. */
export default function V3Layout({ children }: { children: ReactNode }) {
  if (!devPagesOpen()) notFound();
  return children;
}
