import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountShell } from "@/components/account/AccountShell";
import { RecapCard } from "@/components/app/DrivesTracker";
import { TabBar } from "@/components/app/TabBar";
import { SAMPLE_RECAP } from "@/lib/sample/loop";

export const metadata: Metadata = { title: "Recap preview", robots: { index: false, follow: false } };

export default function RecapPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AccountShell>
      <div className="wr-app">
        <p className="wr-sample">Sample week. Counts are only what the student did; nothing is padded.</p>
        <RecapCard recap={SAMPLE_RECAP} />
        <TabBar active="home" />
      </div>
    </AccountShell>
  );
}
