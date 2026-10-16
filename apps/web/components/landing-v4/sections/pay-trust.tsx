import type { TraceDemo } from "../../landing/types";
import { Chapter, H2, LEAD } from "./chapter";
import { PayTrace } from "./pay-trace";
import { Reveal } from "./reveal";

/** Chapter 5, trust. One real posting's pay trace; click a step to light the words it was read from. */
export function PayTrust({ trace }: { trace: TraceDemo | null }) {
  if (!trace) return null;
  return (
    <Chapter id="pay" chapter="Trust">
      <div className="grid items-start gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal className="lg:sticky lg:top-28">
          <h2 className={H2}>Pay, read from the posting.</h2>
          <p className={`${LEAD} mt-5 max-w-[28ch]`}>Click a step. See the words it came from.</p>
        </Reveal>
        <Reveal index={1}>
          <PayTrace trace={trace} />
        </Reveal>
      </div>
    </Chapter>
  );
}
