import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountShell } from "@/components/account/AccountShell";
import { Home } from "@/components/app/Home";
import { SAMPLE_HOME } from "@/lib/sample/home";

export const metadata: Metadata = { title: "Home preview", robots: { index: false, follow: false } };

/** Dev-only preview of the student Home with a labelled sample student. Not found in production. */
export default function HomePreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AccountShell>
      <Home data={SAMPLE_HOME} />
    </AccountShell>
  );
}
