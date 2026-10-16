import "server-only";
import { unstable_cache } from "next/cache";
import { withAdmin } from "@hirelane/db";

export const TOP_COMPANIES = 12;

export type CompanyRoles = { name: string; openRoles: number };

async function load(): Promise<CompanyRoles[]> {
  return withAdmin(async (db) => {
    const { rows } = await db.query(
      `SELECT c.name, count(*)::int AS open_roles
         FROM jobs j JOIN companies c ON c.id = j.company_id
        WHERE j.closed_at IS NULL AND j.slug NOT LIKE 'e2e-%'
        GROUP BY c.id, c.name
        ORDER BY open_roles DESC, c.name
        LIMIT $1`,
      [TOP_COMPANIES],
    );
    return rows.map((r: { name: string; open_roles: number }) => ({ name: r.name, openRoles: Number(r.open_roles) }));
  });
}

/** The companies with the most open roles right now, from the database, cached 300 s under tag `jobs`. */
export const getTopCompanies = unstable_cache(load, ["landing-v3:top-companies"], { revalidate: 300, tags: ["jobs"] });
