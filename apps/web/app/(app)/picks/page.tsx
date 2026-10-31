import type { Metadata } from "next";
import { Deck } from "@/components/student/Deck";
import { StudentShell } from "@/components/student/AppShell";
import { loadStudentPicks } from "@/lib/student/load";
import { SAMPLE_ADDRESS, SAMPLE_CARDS } from "@/lib/student/sample";

export const metadata: Metadata = { title: "Today’s picks", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Today's ranked roles from GET /api/v1/picks (the same service), as a deck. */
export default async function PicksPage() {
  const s = await loadStudentPicks();
  const real = s.source === "real";
  const data = real ? s.data : { initial: "R", badge: 2, cards: SAMPLE_CARDS, autoApply: true, pilot: true, applyAddress: SAMPLE_ADDRESS };
  return (
    <StudentShell active="picks" initial={data.initial} badge={data.badge}>
      <div className="st-a-head">
        <h1 className="st-a-title">Today’s picks</h1>
        {real ? null : <p className="st-sample">Sample student. On a phone, swipe the card. On a computer, pick from the list and use the buttons or arrow keys.</p>}
      </div>
      <Deck cards={data.cards} variant="picks" autoApply={data.autoApply} address={data.applyAddress} network={real && data.pilot} />
    </StudentShell>
  );
}
