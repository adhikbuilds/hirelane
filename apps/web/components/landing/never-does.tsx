import { Check, X } from "lucide-react";
import { Reveal } from "../ui";
import { SectionHeading } from "./section-heading";

const ROWS = [
  { never: "Send an application without your OK", instead: "Every application waits for your approval, then gives you four seconds to undo." },
  { never: "Invent an answer", instead: "If your resume does not say it, the field is marked Needs you and left empty." },
  { never: "Show your lowest pay", instead: "Your pay floor stays on your side. Employers never see it." },
  { never: "Sell your data", instead: "Your resume is private to you, encrypted at rest and never shared or sold." },
];

export function NeverDoes() {
  return (
    <section id="never" aria-labelledby="never-h" className="scroll-mt-16 bg-canvas py-16 sm:py-24" data-testid="never-does">
      <div className="mx-auto max-w-page px-4 sm:px-8">
        <Reveal>
          <SectionHeading eyebrow="Our promises" title="What Hirelane never does" id="never-h" />
        </Reveal>
        <div className="mt-10 overflow-hidden rounded-[20px] border border-line bg-surface shadow-card">
          <div className="hidden grid-cols-2 border-b border-line bg-canvas px-6 py-3 text-[13px] font-extrabold text-ink-3 md:grid">
            <span>Never</span>
            <span>Instead</span>
          </div>
          <ul className="divide-y divide-line">
            {ROWS.map((r, i) => (
              <li key={r.never}>
                <Reveal delay={i * 0.06} className="grid gap-3 px-5 py-5 md:grid-cols-2 md:gap-8 md:px-6">
                  <p className="flex items-start gap-3 text-[18px] font-extrabold leading-6 tracking-tight">
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-miss-50 text-[#b91c1c]">
                      <X aria-hidden className="size-4" strokeWidth={3} />
                    </span>
                    <span>
                      <span className="sr-only">Never: </span>
                      {r.never}
                    </span>
                  </p>
                  <p className="flex items-start gap-3 text-[16px] leading-6 text-ink-2">
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-lane-50 text-lane">
                      <Check aria-hidden className="size-4" strokeWidth={3} />
                    </span>
                    <span>
                      <span className="sr-only">Instead: </span>
                      {r.instead}
                    </span>
                  </p>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
