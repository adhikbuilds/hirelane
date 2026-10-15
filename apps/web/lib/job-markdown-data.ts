import "server-only";
import { withAdmin } from "@hirelane/db";
import { getJobBySlug } from "./job-data";
import type { MarkdownJob } from "./job-markdown";

/** The job detail plus the display description, which the HTML page does not need. */
export async function getMarkdownJob(slug: string): Promise<MarkdownJob | null> {
  const job = await getJobBySlug(slug);
  if (!job) return null;
  const md = await withAdmin(async (db) => (await db.query("SELECT description_md FROM jobs WHERE id = $1", [job.id])).rows[0]?.description_md ?? null);
  return { ...job, descriptionMd: typeof md === "string" ? md : null };
}
