import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountShell } from "@/components/account/AccountShell";
import { Tracker } from "@/components/app/DrivesTracker";
import { TabBar } from "@/components/app/TabBar";
import { SAMPLE_TRACKER } from "@/lib/sample/loop";

export const metadata: Metadata = { title: "Tracker preview", robots: { index: false, follow: false } };

export default function TrackerPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AccountShell>
      <div className="wr-app">
        <p className="wr-sample">Sample applications. Phones group them by stage; laptops show a board.</p>
        <Tracker items={SAMPLE_TRACKER} />
        <TabBar active="tracker" />
      </div>
    </AccountShell>
  );
}
