/**
 * "Asha, data engineer, Bengaluru": the sample character of the whole v4 page (docs/design/landing-v4.md, the theme).
 * A fictional person, always labelled "Sample profile". The skill labels are the exact labels used on real postings
 * ("Apache Kafka", not "Kafka"), so every score is a real intersection with a real job's requirements.
 */
export const ASHA = {
  name: "Asha Verma",
  email: "asha.verma@example.com",
  linkedin: "linkedin.com/in/asha-verma-sample",
  headline: "Data engineer, 4 years",
  city: "Bengaluru",
  roles: ["Data engineer", "Analytics engineer"],
  skills: ["Python", "SQL", "Apache Spark", "Apache Airflow", "AWS", "Apache Kafka"],
  resumeFile: "Asha_Verma_data_engineer.pdf",
  pitch: "I build batch and streaming pipelines that stay boring in production: Spark, Airflow and Kafka on AWS.",
  label: "Sample profile",
} as const;

export const ASHA_SKILL_SET: ReadonlySet<string> = new Set(ASHA.skills.map((s) => s.toLowerCase()));
