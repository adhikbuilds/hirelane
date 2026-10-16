import "server-only";
import { withAdmin } from "@hirelane/db";
import { searchJobs } from "@/lib/queries/jobs";
import { toSimilar, type SimilarJob } from "./similar-model";

/** Open roles in the same role family and country as `slug`, freshest first, never the job itself. */
export async function similarJobs(slug: string, limit = 10): Promise<SimilarJob[]> {
  const ref = await withAdmin(async (db) => {
    const r = (await db.query("SELECT role_family, countries FROM jobs WHERE slug = $1", [slug])).rows[0];
    return r ? { role: (r.role_family as string | null) ?? undefined, country: ((r.countries as string[] | null) ?? [])[0]?.trim() } : null;
  });
  if (!ref?.role) return [];
  try {
    const res = await searchJobs({
      filter: { role: ref.role, ...(ref.country ? { country: ref.country } : {}) },
      page: 1,
      pageSize: limit + 6,
      sort: "fresh",
    });
    return res.jobs
      .filter((j) => j.slug !== slug)
      .slice(0, limit)
      .map(toSimilar);
  } catch {
    return [];
  }
}
