import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Rows, Section } from "@/components/landing/page-shell";

export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach Hirelane about privacy, data removal or a wrong listing.",
};

export default function Contact() {
  return (
    <PageShell title="Contact." lede="Hirelane is built by one independent developer, adhikbuilds. A monitored inbox is being set up.">
      <Section id="privacy-contact" title="Privacy and data requests">
        <p data-testid="privacy-contact" className="mt-3 max-w-[72ch] rounded border-2 border-rule-strong p-4 font-semibold">
          Privacy contact and grievance officer: to be named before accounts open.
        </p>
      </Section>
      <Section id="other" title="Other things">
        <Rows
          rows={[
            { lead: "A wrong listing", text: "Each job links to its source posting, which is the authority. Report errors to the employer, or check the status page for ingest problems." },
            { lead: "Service health", text: "The status page shows how fresh the data is." },
          ]}
        />
      </Section>
      <p className="text-ink-2">
        See <Link href="/privacy" className="font-medium text-lane hover:underline">privacy</Link>,{" "}
        <Link href="/terms" className="font-medium text-lane hover:underline">terms</Link> and{" "}
        <Link href="/status" className="font-medium text-lane hover:underline">status</Link>.
      </p>
    </PageShell>
  );
}
