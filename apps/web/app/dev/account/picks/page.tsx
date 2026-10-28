import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountShell } from "@/components/account/AccountShell";
import { CheckScreen, HandoffToast } from "@/components/app/Picks";
import { SwipeDeck } from "@/components/app/SwipeDeck";
import { DECK } from "@/lib/sample/deck";
import { TabBar } from "@/components/app/TabBar";
import { SAMPLE_ANSWERS, SAMPLE_PICK } from "@/lib/sample/loop";

export const metadata: Metadata = { title: "Picks preview", robots: { index: false, follow: false } };

/** Dev-only: the loop on a sample role. Phone: one card at a time. Desktop: card and check side by side. */
export default function PicksPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AccountShell>
      <div className="wr-app">
        <p className="wr-sample">Sample role and student. On a phone you see one step at a time; on a laptop the card and the check sit side by side.</p>
        <div className="wr-app wr-workbench" style={{ padding: 0 }}>
          <SwipeDeck cards={DECK} />
          <div className="wr-app" style={{ padding: 0 }}>
            <CheckScreen card={SAMPLE_PICK} answers={SAMPLE_ANSWERS} />
            <HandoffToast company={SAMPLE_PICK.company} weekCount={4} />
          </div>
        </div>
        <TabBar active="home" />
      </div>
    </AccountShell>
  );
}
