import { Chapter, H2, LEAD } from "./chapter";
import { APPLICATIONS, FORM_FIELDS } from "./links";
import { ProblemPile } from "./problem-pile";
import { Reveal } from "./reveal";

/** Chapter 2, the problem. Show, don't tell: a pile of near-identical forms and a computed counter. */
export function Problem({ fieldCount = FORM_FIELDS, applications = APPLICATIONS }: { fieldCount?: number; applications?: number }) {
  return (
    <Chapter id="problem" chapter="The problem">
      <div className="grid items-center gap-14 lg:grid-cols-[0.9fr_1.1fr]">
        <Reveal>
          <h2 className={H2}>Applying is a second job.</h2>
          <p className={`${LEAD} mt-5 max-w-[26ch]`}>Same name, same answers, every form.</p>
        </Reveal>
        <ProblemPile fieldCount={fieldCount} applications={applications} />
      </div>
    </Chapter>
  );
}
