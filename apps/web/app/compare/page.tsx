import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, Section } from "@/components/landing/page-shell";

export const metadata: Metadata = {
  title: "Compare",
  description: "An honest comparison of Hirelane with bulk auto-apply bots and browser extensions, by category.",
};

const cols = ["Bulk auto-apply bots", "Browser extensions", "Hirelane"] as const;
const rows: { topic: string; cells: [string, string, string] }[] = [
  {
    topic: "Where jobs come from",
    cells: [
      "Usually scraped listings of mixed age. Some may already be closed.",
      "Whatever site you are already on. They add nothing to the search.",
      "Public employer board APIs, with each job's last-checked time shown.",
    ],
  },
  {
    topic: "Who sends the application",
    cells: [
      "The bot, on your behalf, often without you reading it.",
      "You do, after the extension fills in the form.",
      "You do. Hirelane will hand you the employer's own form with everything ready (early access).",
    ],
  },
  {
    topic: "What the answers say",
    cells: [
      "Generic text, or text that claims things your resume does not support.",
      "Saved answers you wrote once, reused as they are.",
      "Will be drafted from your resume, each with its source, with gaps marked Needs you (early access).",
    ],
  },
  {
    topic: "Pay",
    cells: ["Shown if the scraped text had it.", "Not their job.", "Normalised with every step shown, or marked not stated."],
  },
  {
    topic: "Volume",
    cells: [
      "Their strength: hundreds of applications a day.",
      "As fast as you can click through forms.",
      "Deliberately lower. You will approve each application, and the planned free plan has a limit of 10.",
    ],
  },
  {
    topic: "Reach",
    cells: [
      "Any site they can drive.",
      "Any site, including ones Hirelane does not read. This is their strength.",
      "Only employers on Greenhouse, Lever and Ashby boards for now.",
    ],
  },
  {
    topic: "Risk to your name",
    cells: [
      "High. A wrong answer goes out under your name and you may not see it.",
      "Low. You see the form before you send it.",
      "Low. Nothing will leave until you approve, with a four second undo (early access).",
    ],
  },
];

export default function Compare() {
  return (
    <PageShell
      title="Where Hirelane fits, and where it does not."
      lede="Two kinds of tool already exist. This compares them by category, not by brand, and says where each one is the better choice. Today the Hirelane job board is live; rows marked early access describe what opens next."
    >
      <Section id="table" title="Side by side">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left align-top" data-testid="compare-table">
            <thead className="text-[13px] text-ink-3">
              <tr className="border-b border-rule">
                <th className="w-40 py-2 pr-4 font-medium">
                  <span className="sr-only">Topic</span>
                </th>
                {cols.map((c) => (
                  <th key={c} scope="col" className={`py-2 pr-4 font-semibold ${c === "Hirelane" ? "text-lane" : "text-ink-2"}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.topic} className="border-b border-rule align-top">
                  <th scope="row" className="py-3 pr-4 font-semibold">{r.topic}</th>
                  {r.cells.map((c, i) => (
                    <td key={cols[i]} className="py-3 pr-4 text-ink-2">{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="when" title="When to pick something else">
        <p className="mt-3 max-w-[72ch]">
          If you want the most applications in the least time and accept the risk, a bulk bot does that and Hirelane will not.
          If you apply to employers outside the three boards Hirelane reads, an extension works there and Hirelane does not.
          Hirelane is for people who would rather send fewer applications that are right.
        </p>
        <p className="mt-3 text-ink-2">
          The details of what Hirelane does are on <Link href="/how-it-works" className="font-medium text-lane hover:underline">how it works</Link>.
        </p>
      </Section>
    </PageShell>
  );
}
