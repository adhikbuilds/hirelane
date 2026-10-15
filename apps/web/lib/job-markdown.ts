/** Pure renderer: one job to a markdown document for agents (design section 6). No I/O, no raw HTML in the output. */
import type { JobDetail } from "./job-data";
import { formatSalary, safeHttpUrl, traceRows } from "./job-view";
import { htmlToMarkdown } from "./markdown";

export type MarkdownJob = JobDetail & { descriptionMd: string | null };
export type RenderOptions = { origin: string; now: Date };

/** Keeps the markdown well under 30% of the HTML page, whose own payload repeats the description. */
const DESCRIPTION_CAP = 12_000;

const q = (v: string | null | undefined) => (v === null || v === undefined ? "null" : JSON.stringify(v));
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function jobSalaryDisplay(job: JobDetail): string | null {
  const s = job.salary;
  return formatSalary({ minMinor: s.minMinor, maxMinor: s.maxMinor, currency: s.currency, period: s.period });
}

export function renderJobMarkdown(job: MarkdownJob, opts: RenderOptions): string {
  const origin = opts.origin.replace(/\/+$/, "");
  const salary = jobSalaryDisplay(job);
  const closed = job.closedAt ? `closed ${job.closedAt.toISOString().slice(0, 10)}` : "open";

  const front = [
    `slug: ${q(job.slug)}`,
    `url: ${q(`${origin}/job/${job.slug}`)}`,
    `company: ${q(job.companyName)}`,
    `countries: ${JSON.stringify(job.countries)}`,
    `workplace: ${q(job.workplace)}`,
    `level: ${q(job.level)}`,
    `employment: ${q(job.employment)}`,
    `visa: ${q(job.visa)}`,
    `salary: ${q(salary)}`,
    `posted: ${q(iso(job.postedAt))}`,
    `last_checked: ${q(iso(job.lastSeenAt))}`,
    `status: ${q(closed)}`,
    `source: ${q(job.source)}`,
  ];

  const title = oneLine(job.title);
  const parts: string[] = [`---\n${front.join("\n")}\n---`, `# ${title} at ${oneLine(job.companyName)}`];

  // Pay
  const pay: string[] = ["## Pay"];
  if (!salary) {
    pay.push("Not stated in the posting.");
  } else {
    pay.push(salary + (job.salary.kind === "ote" ? " (on-target earnings, not base pay)" : ""));
    const rows = traceRows(job.salary.trace);
    if (rows.length > 0) pay.push(rows.map((r, i) => `${i + 1}. ${oneLine(r.label)}`).join("\n"));
  }
  parts.push(pay.join("\n\n"));

  // Requirements
  const must = job.requirements.filter((r) => r.kind === "must");
  const nice = job.requirements.filter((r) => r.kind === "nice");
  if (must.length + nice.length > 0) {
    const req: string[] = ["## Requirements"];
    if (must.length) req.push(`Must have\n\n${must.map((r) => `- ${oneLine(r.text)}`).join("\n")}`);
    if (nice.length) req.push(`Nice to have\n\n${nice.map((r) => `- ${oneLine(r.text)}`).join("\n")}`);
    parts.push(req.join("\n\n"));
  }

  if (job.skills.length > 0) parts.push(`## Skills\n\n${job.skills.map((s) => oneLine(s.label)).join(", ")}`);

  const body = htmlToMarkdown(job.descriptionMd ?? job.descriptionText, { maxChars: DESCRIPTION_CAP }).replace(/^#{1,2}(?=\s)/gm, "###");
  if (body) {
    const cut = body.endsWith("…") ? `\n\n(Shortened. The full text is at ${origin}/job/${job.slug}.)` : "";
    parts.push(`## Description\n\n${body}${cut}`);
  }

  const apply = job.closedAt ? null : safeHttpUrl(job.applyUrl);
  const applyLines = ["## Apply"];
  if (apply) applyLines.push(`Apply on the employer's own form: ${apply}`);
  else applyLines.push(job.closedAt ? "This job is closed." : "No employer link is on file.");
  applyLines.push("Hirelane does not submit applications. Nothing is sent to the employer without the applicant's approval.");
  parts.push(applyLines.join("\n\n"));

  return parts.join("\n\n") + "\n";
}

/**
 * Employer- and model-derived strings go into markdown as plain text: backslash-escape every inline
 * markdown metacharacter so a title like "[Apply here](https://evil)" can't become a link.
 */
export const escapeInline = (s: string) => s.replace(/([\\`*_\[\]()<>])/g, "\\$1");
const oneLine = (s: string) => escapeInline(s.replace(/\s+/g, " ").trim());
