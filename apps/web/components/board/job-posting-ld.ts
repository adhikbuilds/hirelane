/**
 * schema.org JobPosting for one job page, following Google's JobPosting rules (checked 2026-10-16):
 * required datePosted, description, hiringOrganization, jobLocation (or applicantLocationRequirements when 100% remote), title.
 * Pay is emitted only when the employer stated it (board fields or posting text), never when derived or model-read.
 * Closed jobs and jobs that cannot satisfy the location rules return null: no markup is better than invalid markup.
 */
import type { JobDetail } from "../../lib/job-data";
import { resolveLocations } from "./locations";

type Place = { "@type": "Place"; address: { "@type": "PostalAddress"; addressLocality?: string; addressCountry: string } };
type Value = { "@type": "QuantitativeValue"; minValue?: number; maxValue?: number; value?: number; unitText: string };

export type JobPostingLd = {
  "@context": "https://schema.org";
  "@type": "JobPosting";
  title: string;
  description: string;
  datePosted: string;
  url: string;
  hiringOrganization: { "@type": "Organization"; name: string };
  identifier: { "@type": "PropertyValue"; name: string; value: string };
  directApply: false;
  employmentType?: string;
  jobLocation?: Place[];
  jobLocationType?: "TELECOMMUTE";
  applicantLocationRequirements?: { "@type": "Country"; name: string }[];
  baseSalary?: { "@type": "MonetaryAmount"; currency: string; value: Value };
};

const EMPLOYMENT: Record<string, string> = { fulltime: "FULL_TIME", parttime: "PART_TIME", contract: "CONTRACTOR", intern: "INTERN" };
const UNIT: Record<string, string> = { hour: "HOUR", day: "DAY", week: "WEEK", month: "MONTH", year: "YEAR" };
const ZERO_DECIMAL = new Set(["JPY", "KRW"]);
const STATED_BY_EMPLOYER = new Set(["ats_structured", "text"]);

function baseSalary(s: JobDetail["salary"]): JobPostingLd["baseSalary"] | null {
  if (!s.source || !STATED_BY_EMPLOYER.has(s.source)) return null;
  if (s.kind === "ote") return null;
  if (!s.currency || !s.period || !UNIT[s.period]) return null;
  if (s.minMinor === null && s.maxMinor === null) return null;
  const div = ZERO_DECIMAL.has(s.currency) ? 1 : 100;
  const lo = s.minMinor === null ? null : s.minMinor / div;
  const hi = s.maxMinor === null ? null : s.maxMinor / div;
  const unitText = UNIT[s.period]!;
  const value: Value =
    lo !== null && hi !== null && lo !== hi
      ? { "@type": "QuantitativeValue", minValue: lo, maxValue: hi, unitText }
      : { "@type": "QuantitativeValue", value: (lo ?? hi) as number, unitText };
  return { "@type": "MonetaryAmount", currency: s.currency, value };
}

export function buildJobPostingLd(job: JobDetail, origin: string): JobPostingLd | null {
  if (job.closedAt) return null;
  const description = job.descriptionText?.trim();
  if (!description) return null;

  const remote = job.workplace === "remote";
  const countries = [...new Set(job.countries.map((c) => c.trim()).filter(Boolean))];
  const places: Place[] = [];
  const covered = new Set<string>();
  // A 100% remote job is located by who may apply (applicantLocationRequirements), not by a city: jobLocation is left out.
  for (const l of remote ? [] : resolveLocations(job.locations)) {
    if (!l.city || !l.country) continue;
    covered.add(l.country);
    places.push({ "@type": "Place", address: { "@type": "PostalAddress", addressLocality: l.city, addressCountry: l.country } });
  }
  for (const c of countries) {
    if (covered.has(c)) continue;
    if (!remote) places.push({ "@type": "Place", address: { "@type": "PostalAddress", addressCountry: c } });
  }

  if (remote) {
    if (countries.length === 0) return null;
  } else if (places.length === 0) {
    return null;
  }

  const ld: JobPostingLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description,
    datePosted: (job.postedAt ?? job.firstSeenAt).toISOString(),
    url: `${origin}/job/${job.slug}`,
    hiringOrganization: { "@type": "Organization", name: job.companyName },
    identifier: { "@type": "PropertyValue", name: job.companyName, value: job.slug },
    directApply: false,
  };
  const emp = job.employment ? EMPLOYMENT[job.employment] : undefined;
  if (emp) ld.employmentType = emp;
  if (places.length > 0) ld.jobLocation = places;
  if (remote) {
    ld.jobLocationType = "TELECOMMUTE";
    ld.applicantLocationRequirements = countries.map((c) => ({ "@type": "Country", name: c }));
  }
  const pay = baseSalary(job.salary);
  if (pay) ld.baseSalary = pay;
  return ld;
}

/** JSON for a <script type="application/ld+json"> body: no "<" and no line separators can end the element early. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");
}
