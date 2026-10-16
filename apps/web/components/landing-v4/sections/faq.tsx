import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/shadcn/accordion";
import { Chapter, H2 } from "./chapter";
import { Reveal } from "./reveal";

export const FAQ_ITEMS = [
  { q: "Does it ever send without me?", a: "No. Every application waits for your approval, with a four second undo." },
  { q: "Where do the jobs come from?", a: "Public Greenhouse, Lever and Ashby career boards, refreshed every six hours." },
  { q: "What is a Needs-you?", a: "A question your resume can't answer, like visa or notice period. Hirelane stops and asks. It never guesses." },
  { q: "Is the pay real?", a: "Only pay written in the posting. Open any job to see the words it was read from." },
  { q: "What happens to my resume?", a: "In this demo it stays in your browser. Nothing is uploaded." },
] as const;

/** Chapter 8, objections. A shadcn Accordion: one open at a time, arrow keys move between questions. */
export function Faq() {
  return (
    <Chapter id="faq" chapter="Questions" label="Questions">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <h2 className={H2}>Questions people ask.</h2>
        </Reveal>
        <Reveal index={1}>
          <Accordion type="single" collapsible defaultValue="faq-0" data-testid="faq">
            {FAQ_ITEMS.map((it, i) => (
              <AccordionItem key={it.q} value={`faq-${i}`} className="px-5 shadow-[0_1px_2px_rgb(19_32_26/.05)] ring-1 ring-black/5">
                <AccordionTrigger className="min-h-12 !text-[18px] leading-6 hover:text-primary">{it.q}</AccordionTrigger>
                <AccordionContent className="!text-[16px] text-muted-foreground">{it.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </Chapter>
  );
}
