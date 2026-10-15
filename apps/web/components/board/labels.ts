import { ROLE_LABELS } from "../../lib/lists";
import { countryName } from "./places";

const ACRONYMS: Record<string, string> = { ml: "ML", qa: "QA", sre: "SRE", it: "IT" };

/** "software-engineer-backend" becomes "Software engineer, backend"; sentence case, no all-caps labels. */
export function roleLabel(slug: string): string {
  const known = (ROLE_LABELS as Record<string, string>)[slug];
  if (known) return known;
  const words = slug.split("-").map((w) => ACRONYMS[w] ?? w);
  if (slug.startsWith("software-engineer-") && words.length > 2) {
    return `Software engineer, ${words.slice(2).join(" ")}`;
  }
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const WORKPLACE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
export const EMPLOYMENT_LABEL: Record<string, string> = { fulltime: "Full-time", contract: "Contract", parttime: "Part-time", intern: "Internship" };
export const LEVEL_LABEL: Record<string, string> = { entry: "Entry", mid: "Mid", experienced: "Experienced (senior and up)", intern: "Intern" };
export const POSTED_OPTIONS = [1, 3, 7, 14, 30] as const;

export function postedLabel(days: number): string {
  return days === 1 ? "Last 24 hours" : `Last ${days} days`;
}

export { countryName };
