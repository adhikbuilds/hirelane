import { devPagesOpen } from "@/lib/dev-gate";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { evaluateEligibility, parseCriteria } from "@hirelane/engine";
import { StudentShell } from "@/components/student/Shell";
import { PasteJob } from "@/components/app/PasteNetwork";

export const metadata: Metadata = { title: "Paste a job preview", robots: { index: false, follow: false } };

const LEGIT = `Customer Success Associate, Bengaluru (on-site)
Eligibility: B.Com / BBA, 2025 or 2026 passout. Minimum 55% in 10th, 12th and graduation. No active backlogs.`;

/** Dev-only: both outcomes of paste-a-job. Eligibility uses the real engine on sample text. */
export default function PastePreview() {
  if (!devPagesOpen()) notFound();
  const result = evaluateEligibility(parseCriteria(LEGIT), { pct_10: 71, secondary_kind: "12th", pct_secondary: 58, degree: "B.Com", grad_pct_equiv: 64, grad_conversion: "direct", passout_year: 2025, active_backlogs: 0, confirmed: true }, { cgpaRule: null });
  return (
    <StudentShell active="home" initials="R">
      <div className="wr-app">
        <p className="wr-sample">Two sample pastes: a real-looking drive (checked by the real engine) and a scam. Not real postings.</p>
        <h1 className="acct-display wr-hello">Paste a job.</h1>
        <PasteJob text={LEGIT} parsed={{ role: "Customer Success Associate", company: "A SaaS company (sample)", place: "Bengaluru" }} eligibility={result} scam={[]} />
        <PasteJob
          text="URGENT hiring!! Work from home data entry, 45,000/month. Pay Rs 1500 registration fee to confirm your seat. Contact HR on Telegram @hrjobs_desk only. Limited seats!"
          parsed={null}
          eligibility={null}
          scam={[
            { label: "Asks you to pay a fee", quote: "Pay Rs 1500 registration fee" },
            { label: "HR only on Telegram", quote: "Contact HR on Telegram @hrjobs_desk only" },
            { label: "Pressure to act fast", quote: "URGENT hiring!! Limited seats!" },
            { label: "Pay too high for the role", quote: "Work from home data entry, 45,000/month" },
          ]}
        />
      </div>
    </StudentShell>
  );
}
