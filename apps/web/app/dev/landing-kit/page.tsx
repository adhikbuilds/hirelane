import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Kit } from "./kit";

export const metadata: Metadata = { title: "Landing kit", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Dev-only: every shadcn component of landing v3 on the forest, white and black grounds. Not found in production. */
export default function DevLandingKitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Kit />;
}
