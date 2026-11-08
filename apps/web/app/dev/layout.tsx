import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { devPagesOpen } from "@/lib/dev-gate";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Read the environment on every request, never at build time.
export const dynamic = "force-dynamic";

/** Every page under /dev is a 404 in production unless HIRELANE_SAMPLES=1. */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (!devPagesOpen()) notFound();
  return children;
}
