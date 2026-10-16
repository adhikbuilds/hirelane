import { Chip } from "@/components/ui/Chip";
import type { JobDetail } from "@/lib/job-data";

export function Skills({ skills }: { skills: JobDetail["skills"] }) {
  return (
    <section aria-labelledby="skills-h">
      <h2 id="skills-h" className="text-[28px] font-extrabold tracking-[-0.03em]">Skills</h2>
      {skills.length === 0 ? (
        <p className="mt-4 text-ink-3">No skills could be read from this posting.</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2" data-testid="job-skills">
          {skills.map((s) => (
            <li key={s.id}><Chip tone="lane" className="h-9 px-3.5 text-[14px]">{s.label}</Chip></li>
          ))}
        </ul>
      )}
    </section>
  );
}
