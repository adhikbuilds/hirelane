import "server-only";
import { unstable_cache } from "next/cache";
import { withAdmin } from "@hirelane/db";
import { buildSnapshot, proxyScores, perWeekFrom, WINDOW_DAYS, type ProxyJob } from "../../../lib/autopilot-proxy";
import { buildBoard, type BoardCell, type BoardModel } from "./board-model";
import { DEFAULT_MIN, RULE_ROLES, SAMPLE_ROLE, type RuleJob } from "./rule-model";

/** Counts by role family x country. Same predicate as /jobs (open, role_family =, countries @>), so cell = click target. */
async function loadBoard(): Promise<BoardModel> {
  const cells = await withAdmin(async (db) => {
    const { rows } = await db.query(
      `SELECT role_family AS role, c::text AS country, count(*)::int AS n
         FROM jobs j, unnest(j.countries) c
        WHERE j.closed_at IS NULL AND j.role_family IS NOT NULL
        GROUP BY 1, 2`,
    );
    return rows.map((r): BoardCell => ({ role: r.role, country: String(r.country).trim(), n: Number(r.n) }));
  });
  return buildBoard(cells);
}
export const getBoard = unstable_cache(loadBoard, ["landing-v4:board"], { revalidate: 300, tags: ["jobs"] });

type RuleData = { perWeek: number | null; jobs: RuleJob[] };

const TIMELINE_POOL = 40;

/**
 * Asha's rule data. Scores come from the same population the API scores (jobs posted in the last 28 days), so the
 * weekly figure and the timeline agree as the slider moves. The timeline lists the freshest open data-engineer jobs.
 */
async function loadRule(): Promise<RuleData> {
  try {
    const now = new Date();
    const rows = await withAdmin(async (db) => {
      const { rows } = await db.query(
        `SELECT j.slug, j.title, c.name AS company, j.role_family, j.skills, j.closed_at IS NULL AS open,
                j.slug LIKE 'e2e-%' AS seeded, coalesce(j.posted_at, j.first_seen_at) AS fresh_at
           FROM jobs j JOIN companies c ON c.id = j.company_id
          WHERE coalesce(j.posted_at, j.first_seen_at) >= $1::timestamptz - make_interval(days => $2)
            AND coalesce(j.posted_at, j.first_seen_at) <= $1::timestamptz
          ORDER BY coalesce(j.posted_at, j.first_seen_at) DESC, j.id`,
        [now, WINDOW_DAYS],
      );
      return rows;
    });
    const proxy: ProxyJob[] = rows.map((r: any) => ({ roleFamily: r.role_family ?? null, skills: r.skills ?? [] }));
    const scores = proxyScores(proxy);
    const snap = buildSnapshot(proxy, now);
    const jobs: RuleJob[] = [];
    const taken = new Map<string, number>();
    const chipRoles = new Set(RULE_ROLES.flatMap((r) => (r.value ? [r.value] : [])));
    rows.forEach((r: any, i: number) => {
      const role = r.role_family as string | null;
      if (!role || !chipRoles.has(role) || !r.open || r.seeded) return;
      if ((taken.get(role) ?? 0) >= TIMELINE_POOL) return;
      taken.set(role, (taken.get(role) ?? 0) + 1);
      jobs.push({ slug: r.slug, title: r.title, company: r.company, role, freshAt: new Date(r.fresh_at).toISOString(), score: scores[i] ?? 0 });
    });
    return { perWeek: perWeekFrom(snap, DEFAULT_MIN, SAMPLE_ROLE), jobs };
  } catch {
    return { perWeek: null, jobs: [] };
  }
}
export const getRule = unstable_cache(loadRule, ["landing-v4:rule"], { revalidate: 300, tags: ["jobs"] });
