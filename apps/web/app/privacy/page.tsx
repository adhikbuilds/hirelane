import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Rows, Section } from "@/components/landing/page-shell";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Hirelane collects today (almost nothing), and what will change when accounts open.",
};

export default function Privacy() {
  return (
    <PageShell
      title="Privacy: what we collect today, and what changes later."
      lede="Hirelane has no accounts yet. This page describes the product as it is now, then what we commit to before accounts open."
    >
      <Section id="today" title="Today: the public board">
        <Rows
          rows={[
            { lead: "Browsing", text: "The public job board collects no personal data. There is no sign-in, no tracking cookie and no advertising." },
            { lead: "Early-access list", text: "If you join, we store your email address and, if you give it, your graduation year, plus a record that you consented to be emailed once when accounts open. Nothing else is asked." },
            { lead: "Rate limiting", text: "To stop abuse, the sign-up form is rate-limited. For that, your IP address (for IPv6, its /64 network) is used as the key of a short-lived counter. The counter is not linked to your email, and old counters are pruned." },
            { lead: "Resumes", text: "No resumes are uploaded yet. The sample on the front page runs in your browser, reads only the first bytes of the file to check it is a PDF, and sends nothing." },
            { lead: "Leaving the list", text: "Ask us to remove your email and we will delete it. See the contact page." },
          ]}
        />
      </Section>
      <Section id="later" title="When accounts open">
        <p className="mt-3 max-w-[72ch] text-ink-2">These are commitments for the launch, not features you can use today.</p>
        <Rows
          rows={[
            { lead: "Encryption", text: "Resumes and answers will be encrypted at rest." },
            { lead: "AI models", text: "Your resume text will go to a language model only with your consent, and you will be able to withdraw it." },
            { lead: "Deletion", text: "You will be able to delete your account and resume, and the data will be removed within 24 hours." },
            { lead: "Export", text: "You will be able to export what we hold about you." },
            { lead: "Update", text: "This page will be updated before any of this takes effect, and early-access members will be told." },
          ]}
        />
      </Section>
      <Section id="grievance" title="Privacy contact and grievance officer">
        <p data-testid="grievance-officer" className="mt-3 max-w-[72ch] rounded border-2 border-rule-strong p-4 font-semibold">
          Grievance officer and privacy contact: to be named before accounts open.
        </p>
        <p className="mt-3 max-w-[72ch] text-ink-2">
          Until then, see <Link href="/contact" className="font-medium text-lane hover:underline">contact</Link>. Related: <Link href="/terms" className="font-medium text-lane hover:underline">terms</Link>.
        </p>
      </Section>
    </PageShell>
  );
}
