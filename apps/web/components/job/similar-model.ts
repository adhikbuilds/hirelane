import type { PublicJob } from "../../lib/queries/jobs";

export type SimilarJob = {
  slug: string;
  title: string;
  company: string;
  logoPath: string | null;
  salary: string | null;
  place: string | null;
  workplace: PublicJob["workplace"];
};

/** `/uploads/x.png` from an absolute logo URL; null when there is none. */
export function logoPathOf(logoUrl: string | null): string | null {
  if (!logoUrl) return null;
  try {
    return new URL(logoUrl, "http://local.invalid").pathname;
  } catch {
    return null;
  }
}

export function toSimilar(j: PublicJob): SimilarJob {
  return {
    slug: j.slug,
    title: j.title,
    company: j.company.name,
    logoPath: logoPathOf(j.company.logoUrl),
    salary: j.salary?.display ?? null,
    place: j.locations[0] ?? j.countries[0] ?? null,
    workplace: j.workplace,
  };
}
