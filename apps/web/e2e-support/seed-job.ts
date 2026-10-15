import { randomUUID } from "node:crypto";
import pg from "pg";
import { requireDatabaseUrl } from "@hirelane/db/env";

/** Seeds one marked company and one INR LPA job with a salary trace and requirements, and removes them after. */
export const JOB_E2E_TAG = "e2e-phase2";

const DESCRIPTION =
  "We are hiring a data engineer in Bengaluru. You have 5+ years building pipelines in Python. " +
  "Experience with Airflow is a plus. Compensation: 18-25 LPA.";

function step(seq: number, ruleId: string, op: string, label: string, output: unknown = null) {
  return { seq, ruleId, op, label, inputs: {}, output, evidence: [] };
}

export async function seedJob() {
  const client = new pg.Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  const slug = `${JOB_E2E_TAG}-${randomUUID().slice(0, 8)}`;
  const trace = {
    engineVersion: "1.0.0",
    subject: "salary",
    outcome: "value",
    steps: [
      step(0, "salary.num.lpa", "parse", "Read 18-25 LPA as 18,00,000 to 25,00,000 rupees"),
      step(1, "salary.currency.lpa", "detect", "Currency INR (LPA is an Indian unit)", "INR"),
      step(2, "salary.period.lpa_crore", "detect", "Period year (LPA means per annum)", "year"),
      step(3, "salary.period.identity", "identity", "Yearly 18-25 L: already per year"),
      step(4, "salary.fx.convert", "convert", "INR to USD at 0.01129944 (fixture snapshot, 2026-10-15)"),
      step(5, "salary.fx.identity", "identity", "INR is the stated currency; no conversion"),
    ],
  };
  try {
    const company = (
      await client.query("INSERT INTO companies (slug, name) VALUES ($1, $2) RETURNING id", [slug, `Lane Works ${slug.slice(-8)}`])
    ).rows[0].id as string;
    const job = (
      await client.query(
        `INSERT INTO jobs (slug, company_id, title, title_norm, role_family, level, workplace, employment, countries,
                           locations, description_text, doc_hash, salary_min_minor, salary_max_minor, salary_currency,
                           salary_period, salary_annual_usd_min, salary_annual_usd_max, salary_annual_inr_min,
                           salary_annual_inr_max, salary_source, salary_kind, salary_trace, fx_date, salary_stated,
                           skills, posted_at, first_seen_at, last_seen_at, enrich_version, source)
         VALUES ($1, $2, $3, $4, 'data', 'mid', 'hybrid', 'fulltime', '{IN}', $5::jsonb, $6, 'e2e',
                 180000000, 250000000, 'INR', 'year', 2034000, 2825000, 180000000, 250000000, 'text', 'base', $7::jsonb,
                 '2026-10-15', true, '{python}', now() - interval '3 hours', now(), now(), 1, 'fixture')
         RETURNING id`,
        [slug, company, `Data engineer ${slug}`, `data engineer ${slug}`, JSON.stringify({ all: ["Bengaluru, India"] }), DESCRIPTION, JSON.stringify(trace)],
      )
    ).rows[0].id as string;
    const must = "5+ years building pipelines in Python";
    const nice = "Experience with Airflow is a plus";
    const at = (s: string) => DESCRIPTION.indexOf(s);
    for (const [ord, kind, text, cat, years] of [
      [0, "must", must, "experience", 5],
      [1, "nice", nice, "skill", null],
    ] as const) {
      await client.query(
        `INSERT INTO job_requirements (job_id, ord, kind, text, category, years_min, span_start, span_end, section, extractor, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'requirements', 'rule', 0.9)`,
        [job, ord, kind, text, cat, years, at(text), at(text) + text.length],
      );
    }
    return { slug, jobTitle: `Data engineer ${slug}` };
  } finally {
    await client.end();
  }
}

export async function cleanupJob(slug: string) {
  const client = new pg.Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    await client.query("DELETE FROM companies WHERE slug = $1", [slug]); // cascades to the job and its requirements
  } finally {
    await client.end();
  }
}
