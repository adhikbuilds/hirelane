import type { ServiceCtx } from '../ctx';
import { withUserTx } from '../db';
import { istDay } from '../campus/ist';
import { mapPgError } from '../errors';
import { loadStudentContext } from './fit';
import { PICK_MAX_AGE_DAYS, buildPicks, type JobCandidate, type PickInput } from './rank';
import type { Picks } from './types';

const DAY_MS = 86_400_000;
/** The newest jobs considered per request. Older ones are past the freshness limit anyway. */
const POOL = 400;

export interface PicksOptions {
  /** People the student knows at a company. No source exists yet (the connections upload is a later slice), so the default is none. */
  whoYouKnow?: PickInput['whoYouKnow'];
}

const locationsOf = (v: unknown): string[] => {
  const all = Array.isArray(v) ? v : Array.isArray((v as { all?: unknown } | null)?.all) ? (v as { all: unknown[] }).all : [];
  return all.filter((x): x is string => typeof x === 'string');
};
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * GET /api/v1/picks. Today's ranked roles for the signed-in student only, computed from the open jobs the ingest holds (so a
 * new ingest changes the next call; nothing is stored). All reads use the student's own session.
 */
export async function getPicks(ctx: ServiceCtx, opts: PicksOptions = {}): Promise<Picks> {
  const now = ctx.now();
  try {
    return await withUserTx(ctx, async (c) => {
      const student = await loadStudentContext(c, ctx.userId);
      const date = istDay(now);
      if (student.placed) return { placed: true, date, picks: [] };
      const since = new Date(now.getTime() - PICK_MAX_AGE_DAYS * DAY_MS);
      const rows = (
        await c.query(
          `SELECT j.id, j.slug, j.company_id, c.name AS company_name, j.title, j.title_norm, j.level, left(j.description_text, 20000) AS description_text,
                  j.locations, j.remote, j.posted_at, j.first_seen_at, j.last_seen_at, j.closed_at, j.salary_stated,
                  j.salary_min_minor, j.salary_max_minor, j.salary_currency, j.salary_period
             FROM jobs j JOIN companies c ON c.id = j.company_id
            WHERE j.closed_at IS NULL AND coalesce(j.posted_at, j.first_seen_at) > $1 AND j.last_seen_at > $1
            ORDER BY coalesce(j.posted_at, j.first_seen_at) DESC, j.id
            LIMIT ${POOL}`,
          [since],
        )
      ).rows;
      const ids = rows.map((r) => r.id as string);
      const musts = new Map<string, JobCandidate['musts']>();
      if (ids.length > 0) {
        const reqs = (await c.query("SELECT job_id, text, skill_ids, years_min FROM job_requirements WHERE job_id = ANY($1::uuid[]) AND kind = 'must' ORDER BY job_id, ord", [ids])).rows;
        for (const r of reqs) {
          const list = musts.get(r.job_id) ?? [];
          list.push({ text: String(r.text), skillIds: (r.skill_ids as string[]) ?? [], yearsMin: num(r.years_min) });
          musts.set(r.job_id, list);
        }
      }
      const applied = (await c.query("SELECT job_id FROM applications WHERE user_id = $1 AND status <> 'undone'", [ctx.userId])).rows.map((r) => r.job_id as string);
      const jobs: JobCandidate[] = rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        companyId: r.company_id,
        companyName: r.company_name,
        title: r.title,
        titleNorm: r.title_norm,
        level: r.level ?? null,
        descriptionText: r.description_text ?? null,
        locations: locationsOf(r.locations),
        remote: r.remote === true,
        postedAt: r.posted_at ?? null,
        firstSeenAt: r.first_seen_at,
        lastSeenAt: r.last_seen_at,
        closedAt: r.closed_at ?? null,
        salaryStated: r.salary_stated === true,
        salary: r.salary_currency ? { minMinor: num(r.salary_min_minor), maxMinor: num(r.salary_max_minor), currency: r.salary_currency, period: r.salary_period ?? null } : null,
        musts: musts.get(r.id) ?? [],
      }));
      const picks = buildPicks({
        jobs,
        profile: student.profile,
        cgpaRule: student.cgpaRule,
        universityRule: student.universityRule,
        fit: student.fit,
        now,
        exclude: new Set(applied),
        placed: false,
        ...(opts.whoYouKnow ? { whoYouKnow: opts.whoYouKnow } : {}),
      });
      return { placed: false, date, picks };
    });
  } catch (e) {
    throw mapPgError(e);
  }
}
