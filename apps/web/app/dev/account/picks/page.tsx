import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StudentShell } from "@/components/student/Shell";
import { CheckScreen, HandoffToast } from "@/components/app/Picks";
import { SwipeDeck } from "@/components/app/SwipeDeck";
import { DECK } from "@/lib/sample/deck";
import { SAMPLE_ANSWERS, SAMPLE_PICK } from "@/lib/sample/loop";

export const metadata: Metadata = { title: "Picks preview", robots: { index: false, follow: false } };

/** Dev-only: the loop on a sample role. Phone: one card at a time. Desktop: card and check side by side. */
export default function PicksPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <StudentShell active="home" initials="R">
      <div className="wr-app">
        <p className="wr-sample">Sample role and student. On a phone you see one step at a time; on a laptop the card and the check sit side by side.</p>
        <div className="wr-app wr-workbench" style={{ padding: 0 }}>
          <SwipeDeck cards={DECK} />
          <div className="wr-app" style={{ padding: 0 }}>
            <CheckScreen card={SAMPLE_PICK} answers={SAMPLE_ANSWERS} />
            <HandoffToast company={SAMPLE_PICK.company} weekCount={4} />
          </div>
        </div>
      </div>
    </StudentShell>
  );
}
