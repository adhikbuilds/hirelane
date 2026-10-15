import { describe, expect, it } from "vitest";
import { ROLE_FAMILIES } from "@hirelane/engine";
import {
  LISTS,
  LIST_COUNTRIES,
  MIN_PUBLISHED,
  facetKeyOf,
  groupPublished,
  isPublished,
  listBySlug,
  listForFilter,
  listRobots,
  listTitle,
  filterToQuery,
} from "../lib/lists";

describe("list registry", () => {
  it("generates the cross product: roles x countries + remote + salary", () => {
    expect(LISTS.length).toBe(ROLE_FAMILIES.length * LIST_COUNTRIES.length + ROLE_FAMILIES.length * 2);
  });

  it("has unique, url-safe slugs", () => {
    const slugs = LISTS.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it("names follow the documented slug shapes", () => {
    expect(listBySlug("data-engineer-jobs-in-india")?.filter).toEqual({ role: "data-engineer", country: "IN" });
    expect(listBySlug("remote-software-engineer-backend-jobs")?.filter).toEqual({
      role: "software-engineer-backend",
      remote: true,
    });
    expect(listBySlug("ml-engineer-jobs-with-salary")?.filter).toEqual({ role: "ml-engineer", salary: true });
    expect(listBySlug("data-engineer-jobs-in-india")?.name).toBe("Data engineer jobs in India");
    expect(listBySlug("remote-ml-engineer-jobs")?.name).toBe("Remote ML engineer jobs");
    expect(listBySlug("remote-data-engineer-jobs")?.name).toBe("Remote data engineer jobs");
    expect(listBySlug("nope")).toBeUndefined();
    expect(listBySlug("")).toBeUndefined();
    expect(listBySlug("__proto__")).toBeUndefined();
  });

  it("every list has a filter, a facet key and a /jobs link that agree", () => {
    for (const l of LISTS) {
      expect(l.jobsHref).toBe(`/jobs?${filterToQuery(l.filter)}`);
      expect(facetKeyOf(l)).toMatch(/^(role_country|remote_role|salary_role):[a-z-]+:(\*|[A-Z]{2})$/);
      expect(listForFilter(l.filter)).toBe(l);
    }
  });

  it("serialises filters in canonical parameter order", () => {
    expect(filterToQuery({ role: "data-engineer", country: "IN" })).toBe("role=data-engineer&country=IN");
    expect(filterToQuery({ salary: true, remote: true, role: "design" })).toBe("role=design&remote=1&salary=1");
  });

  it("matches filters exactly, not loosely", () => {
    expect(listForFilter({ role: "data-engineer", country: "IN" })?.slug).toBe("data-engineer-jobs-in-india");
    expect(listForFilter({ role: "data-engineer", country: "IN", visa: true })).toBeUndefined();
    expect(listForFilter({ role: "data-engineer" })).toBeUndefined();
    expect(listForFilter({})).toBeUndefined();
  });

  it("facet keys follow job_facets.k", () => {
    expect(facetKeyOf(listBySlug("data-engineer-jobs-in-india")!)).toBe("role_country:data-engineer:IN");
    expect(facetKeyOf(listBySlug("remote-data-engineer-jobs")!)).toBe("remote_role:data-engineer:*");
    expect(facetKeyOf(listBySlug("data-engineer-jobs-with-salary")!)).toBe("salary_role:data-engineer:*");
  });
});

describe("publication", () => {
  it("publishes at the threshold and noindexes below it", () => {
    expect(MIN_PUBLISHED).toBe(20);
    expect(isPublished(20)).toBe(true);
    expect(isPublished(19)).toBe(false);
    expect(isPublished(0)).toBe(false);
    expect(isPublished(undefined)).toBe(false);
    expect(listRobots(20)).toEqual({ index: true, follow: true });
    expect(listRobots(19)).toEqual({ index: false, follow: true });
    expect(listRobots(undefined)).toEqual({ index: false, follow: true });
  });

  it("titles carry the live count and refresh age", () => {
    const def = listBySlug("data-engineer-jobs-in-india")!;
    expect(listTitle(def, 1234, "2h")).toBe("Data engineer jobs in India: 1,234 open, refreshed 2h ago");
    expect(listTitle(def, 3, null)).toBe("Data engineer jobs in India: 3 open");
  });

  it("groups only published lists, by kind, biggest first", () => {
    const a = listBySlug("data-engineer-jobs-in-india")!;
    const b = listBySlug("ml-engineer-jobs-in-india")!;
    const c = listBySlug("design-jobs-in-india")!;
    const r = listBySlug("remote-design-jobs")!;
    const counts = new Map<string, number>([
      [facetKeyOf(a), 40],
      [facetKeyOf(b), 90],
      [facetKeyOf(c), 19],
      [facetKeyOf(r), 25],
    ]);
    const g = groupPublished(counts);
    expect(g["role-country"].map((x) => [x.def.slug, x.n])).toEqual([
      ["ml-engineer-jobs-in-india", 90],
      ["data-engineer-jobs-in-india", 40],
    ]);
    expect(g["remote-role"].map((x) => x.def.slug)).toEqual(["remote-design-jobs"]);
    expect(g["salary-role"]).toEqual([]);
  });
});
