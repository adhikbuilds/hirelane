import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Gallery } from "./gallery";

export const metadata: Metadata = { title: "UI kit", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Dev-only component gallery: every state of every v2 component. Not found in production. */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
