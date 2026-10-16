import { AutopilotPanel } from "./autopilot-panel";
import { Chapter } from "./chapter";
import { getRule } from "./data";
import { Reveal } from "./reveal";

/** Chapter 4, control. Asha's rule on the one dark ink surface, with the real weekly figure and a timeline of real jobs. */
export async function Autopilot() {
  const rule = await getRule();
  return (
    <Chapter id="autopilot" chapter="Control" label="Autopilot" className="!py-12 md:!py-16">
      <Reveal>
        <AutopilotPanel initialPerWeek={rule.perWeek} jobs={rule.jobs} nowIso={new Date().toISOString()} />
      </Reveal>
    </Chapter>
  );
}
