import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

/** Resolves one real slug each from the public API, so the spec needs no seeding. */
async function sampleSlugs(request: APIRequestContext) {
  const res = await request.get("/api/public/jobs?page_size=20");
  expect(res.status()).toBe(200);
  // other specs seed short-lived e2e-* jobs that this cached listing may still name
  const job = (await res.json()).jobs.find((j: { slug: string }) => !j.slug.startsWith("e2e-"));
  const company = job.company?.slug ?? job.companySlug;
  const lists = await request.get("/sitemaps/lists.xml");
  const listSlug = /\/lists\/([a-z0-9-]+)</.exec(await lists.text())?.[1];
  return { job: job.slug as string, company: company as string, list: listSlug };
}

test.describe("phase 3 accessibility", () => {
  test("axe finds no serious or critical violations on the public pages", async ({ page, request }) => {
    test.setTimeout(120_000); // cold dev compiles of five routes
    const s = await sampleSlugs(request);
    expect(s.company, "company slug from the API").toBeTruthy();
    expect(s.list, "a published list in the lists sitemap").toBeTruthy();
    const paths = ["/", "/jobs", `/job/${s.job}`, `/company/${s.company}`, `/lists/${s.list}`];
    for (const path of paths) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`),
        path,
      ).toEqual([]);
    }
  });
});
