/** Fixture output. The file is never read: this is what a parse will look like once accounts arrive. */
export const PARSE_FIXTURE = {
  name: "Asha Verma",
  headline: "Data engineer, 4 years",
  roles: ["Data engineer", "Analytics engineer"],
  skills: ["Python", "PostgreSQL", "Kafka", "Airflow", "dbt", "AWS"],
} as const;

/** Steps of the fake parse: 0 name, 1 roles, 2..7 one skill chip each, 8 done. */
export const PARSE_STEPS = 2 + PARSE_FIXTURE.skills.length;
