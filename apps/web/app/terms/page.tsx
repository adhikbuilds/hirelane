import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Rows, Section } from "@/components/landing/page-shell";

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms for using the Hirelane public board and joining early access.",
};

export default function Terms() {
  return (
    <PageShell title="Terms, in plain words." lede="Short, because there is not much product yet. Fuller terms will be published before accounts open.">
      <Section id="use" title="Using the site">
        <Rows
          rows={[
            { lead: "The board", text: "The public job board is free to read. Jobs are listed from public Greenhouse, Lever and Ashby boards and link to the employer's own posting." },
            { lead: "Accuracy", text: "Fields such as pay and location are extracted by rules from the posting and can be wrong. Check the source before you rely on them." },
            { lead: "Applications", text: "Hirelane does not submit applications. Any application you make is made with the employer, on their form." },
            { lead: "Fair use", text: "Automated access is allowed within the published rate limits and robots.txt. Do not try to disrupt the service." },
          ]}
        />
      </Section>
      <Section id="early-access" title="Early access">
        <Rows
          rows={[
            { lead: "Status", text: "There are no accounts yet and nothing to pay for. Joining the list only means we will email you once when accounts open." },
            { lead: "Prices", text: "Plans shown on the front page are planned prices, not an offer. They can change before checkout opens." },
            { lead: "No guarantee", text: "The service is provided as is. We do not promise that any job is still open or that you will get an interview." },
          ]}
        />
      </Section>
      <p className="text-ink-2">
        See <Link href="/privacy" className="font-medium text-lane hover:underline">privacy</Link> and{" "}
        <Link href="/contact" className="font-medium text-lane hover:underline">contact</Link>.
      </p>
    </PageShell>
  );
}
