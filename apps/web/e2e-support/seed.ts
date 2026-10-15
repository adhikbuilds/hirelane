import { randomUUID } from "node:crypto";
import pg from "pg";
import { requireDatabaseUrl } from "@hirelane/db/env";

/** Seeds one marked company, board, run and a few postings for the Phase 1 specs, and removes them after. */
export const E2E_TAG = "e2e-phase1";

export async function seedIngest(count = 3) {
  const client = new pg.Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  const slug = `${E2E_TAG}-${randomUUID().slice(0, 8)}`;
  try {
    const company = (
      await client.query("INSERT INTO companies (slug, name) VALUES ($1, $2) RETURNING id", [slug, `Seed Co ${slug}`])
    ).rows[0].id as string;
    const board = (
      await client.query("INSERT INTO company_boards (company_id, ats, token) VALUES ($1, 'ashby', $2) RETURNING id", [
        company,
        slug,
      ])
    ).rows[0].id as string;
    const run = (
      await client.query(
        `INSERT INTO ingest_runs (trigger, mode, status, finished_at, boards_ok, postings_new)
         VALUES ('manual', 'fixture', 'ok', now(), 1, $1) RETURNING id`,
        [count],
      )
    ).rows[0].id as string;
    await client.query(
      `INSERT INTO ingest_source_runs (run_id, board_id, status, http_status, fetched, new, duration_ms)
       VALUES ($1, $2, 'ok', 200, $3, $3, 120)`,
      [run, board, count],
    );
    for (let i = 0; i < count; i++) {
      await client.query(
        `INSERT INTO postings (board_id, external_id, key, url, title, location_raw, raw, content_hash,
                               posted_at, first_seen_at, last_seen_at, source)
         VALUES ($1, $2, $3, 'https://example.com/j', $4, 'Bengaluru, India', $5, 'h', now() - interval '2 hours', now(), now(), 'fixture')`,
        [
          board,
          `x${i}`,
          `${slug}:${i}`,
          `Seeded role ${i} ${slug}`,
          JSON.stringify(i === 0 ? { compensation: { compensationTierSummary: "$120K - $160K" } } : {}),
        ],
      );
    }
    return { slug, runId: run, companyName: `Seed Co ${slug}`, titleFor: (i: number) => `Seeded role ${i} ${slug}` };
  } finally {
    await client.end();
  }
}

export async function cleanupIngest(slug: string) {
  const client = new pg.Client({ connectionString: requireDatabaseUrl() });
  await client.connect();
  try {
    const runs = await client.query(
      "SELECT DISTINCT run_id FROM ingest_source_runs WHERE board_id IN (SELECT id FROM company_boards WHERE token = $1)",
      [slug],
    );
    await client.query("DELETE FROM companies WHERE slug = $1", [slug]);
    for (const r of runs.rows) await client.query("DELETE FROM ingest_runs WHERE id = $1", [r.run_id]);
  } finally {
    await client.end();
  }
}
