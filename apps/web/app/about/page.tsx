import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Rows, Section } from "@/components/landing/page-shell";

export const metadata: Metadata = {
  title: "About",
  description: "Who builds Hirelane, where its data comes from, and its limits.",
};

export default function About() {
  return (
    <PageShell title="Hirelane is a job search tool built as a timetable." lede="Plain about what it is and what it is not.">
      <Section id="who" title="Who builds it">
        <p className="mt-3 max-w-[72ch]">
          Hirelane is built by adhikbuilds, an independent developer. It is an original product with its own code, design and data.
        </p>
      </Section>
      <Section id="data" title="Where the data comes from">
        <Rows
          rows={[
            { lead: "Jobs", text: "Public job board APIs published by employers through Greenhouse, Lever and Ashby. Nothing is taken from other job sites." },
            { lead: "Freshness", text: "Boards are fetched on a schedule, about every six hours. The live figures are on the status page." },
            { lead: "Pay", text: "Only what a posting states, normalised with the working shown. Never estimated." },
          ]}
        />
      </Section>
      <Section id="limits" title="Limits, stated outright">
        <Rows
          rows={[
            { lead: "Coverage", text: "Employers that do not use those three boards are not here." },
            { lead: "Sending", text: "Hirelane does not submit applications. It hands off to the employer's own form." },
            { lead: "Accuracy", text: "Fields are extracted from free text by rules and can be wrong. Each job links to its source so you can check." },
          ]}
        />
      </Section>
      <p className="text-ink-2">
        See <Link href="/status" className="font-medium text-lane hover:underline">live ingest status</Link> or{" "}
        <Link href="/how-it-works" className="font-medium text-lane hover:underline">how it works</Link>.
      </p>
    </PageShell>
  );
}
