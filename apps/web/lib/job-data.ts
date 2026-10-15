import "server-only";
import { withAdmin } from "@hirelane/db";

export type JobRequirementRow = {
  kind: "must" | "nice";
  text: string;
  category: string;
  yearsMin: number | null;
  spanStart: number;
  spanEnd: number;
  section: string | null;
};

export type JobDetail = {
  id: string;
  slug: string;
  title: string;
  companyName: string;
  companySlug: string;
  logoPath: string | null;
  workplace: string | null;
  employment: string | null;
  level: string | null;
  remoteScope: string;
  countries: string[];
  locations: string[];
  visa: string;
  salary: {
    minMinor: number | null;
    maxMinor: number | null;
    currency: string | null;
    period: string | null;
    annualUsdMin: number | null;
    annualUsdMax: number | null;
    annualInrMin: number | null;
    annualInrMax: number | null;
    source: string | null;
    kind: string | null;
    fxDate: string | null;
    trace: unknown;
  };
  skills: { id: string; label: string }[];
  requirements: JobRequirementRow[];
  descriptionText: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  closedAt: Date | null;
  source: string;
  applyUrl: string | null;
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function getJobBySlug(slug: string): Promise<JobDetail | null> {
  return withAdmin(async (db) => {
    const j = (
      await db.query(
        `SELECT j.*, c.name AS company_name, c.slug AS company_slug, c.logo_path,
                to_char(j.fx_date, 'YYYY-MM-DD') AS fx_day,
                p.url AS posting_url, p.apply_url AS posting_apply_url
           FROM jobs j
           JOIN companies c ON c.id = j.company_id
           LEFT JOIN postings p ON p.id = j.primary_posting_id
          WHERE j.slug = $1`,
        [slug],
      )
    ).rows[0];
    if (!j) return null;

    const reqs = (
      await db.query(
        `SELECT kind, text, category, years_min, span_start, span_end, section
           FROM job_requirements WHERE job_id = $1 ORDER BY ord`,
        [j.id],
      )
    ).rows;

    const skillIds: string[] = j.skills ?? [];
    const labels = new Map<string, string>();
    if (skillIds.length > 0) {
      for (const r of (await db.query("SELECT id, label FROM skills WHERE id = ANY($1::text[])", [skillIds])).rows) {
        labels.set(r.id as string, r.label as string);
      }
    }

    const loc = j.locations as { all?: unknown } | null;
    const locations = Array.isArray(loc?.all) ? (loc.all as unknown[]).filter((x): x is string => typeof x === "string") : [];

    return {
      id: j.id,
      slug: j.slug,
      title: j.title,
      companyName: j.company_name,
      companySlug: j.company_slug,
      logoPath: j.logo_path,
      workplace: j.workplace,
      employment: j.employment,
      level: j.level,
      remoteScope: j.remote_scope,
      countries: (j.countries ?? []) as string[],
      locations,
      visa: j.visa,
      salary: {
        minMinor: num(j.salary_min_minor),
        maxMinor: num(j.salary_max_minor),
        currency: j.salary_currency,
        period: j.salary_period,
        annualUsdMin: num(j.salary_annual_usd_min),
        annualUsdMax: num(j.salary_annual_usd_max),
        annualInrMin: num(j.salary_annual_inr_min),
        annualInrMax: num(j.salary_annual_inr_max),
        source: j.salary_source,
        kind: j.salary_kind,
        fxDate: j.fx_day,
        trace: j.salary_trace,
      },
      skills: skillIds.map((id) => ({ id, label: labels.get(id) ?? id })),
      requirements: reqs.map((r) => ({
        kind: r.kind,
        text: r.text,
        category: r.category,
        yearsMin: r.years_min,
        spanStart: r.span_start,
        spanEnd: r.span_end,
        section: r.section,
      })),
      descriptionText: j.description_text,
      postedAt: j.posted_at,
      firstSeenAt: j.first_seen_at,
      lastSeenAt: j.last_seen_at,
      closedAt: j.closed_at,
      source: j.source,
      applyUrl: j.posting_apply_url ?? j.posting_url ?? null,
    } satisfies JobDetail;
  });
}
