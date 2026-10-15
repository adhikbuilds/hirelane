import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { phaseScreenPaths, savePhaseScreen } from "./support/screens";

const countOf = async (page: Page): Promise<number> => {
  const text = (await page.getByTestId("jobs-count").innerText()).trim();
  return Number(text.split(/\s/)[0]!.replace(/,/g, ""));
};

/** Below lg the filter rail folds into a disclosure that closes itself once hydrated. */
async function openRail(page: Page) {
  const rail = page.getByRole("complementary", { name: "Filters" });
  const details = rail.locator("details").first();
  // Wait for hydration (React tags its DOM nodes), which is when the disclosure closes below lg. Network silence is
  // no signal: prod prefetches every visible link.
  await expect
    .poll(() => details.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))))
    .toBe(true);
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator("summary").first().click();
  return rail;
}

async function pick(page: Page, name: RegExp) {
  const rail = await openRail(page);
  const link = rail.getByRole("link", { name }).first();
  // A drilled-down facet can push a value into its collapsed "Show N more" list.
  if (!(await link.isVisible())) {
    const more = rail.locator("summary", { hasText: /^Show \d+ more$/ });
    for (let i = (await more.count()) - 1; i >= 0; i--) await more.nth(i).click();
  }
  await expect(link).toBeVisible();
  const before = page.url();
  await Promise.all([page.waitForURL((u) => u.href !== before), link.click()]);
  await expect(page.getByTestId("jobs-count")).toBeVisible();
}

test.describe("phase 3 public board", () => {
  test("remote, salary-only and country=IN each change the count and the URL", async ({ page, request }) => {
    await page.goto("/jobs");
    const all = await countOf(page);
    expect(all).toBeGreaterThan(0);

    // India first: once remote and pay-stated are on, the country facet (top 30) no longer lists India.
    await pick(page, /^India\b/);
    expect(new URL(page.url()).searchParams.get("country")).toBe("IN");
    const india = await countOf(page);
    expect(india).toBeLessThan(all);
    await expect(page.getByTestId("jobs-chips")).toContainText("India");

    await pick(page, /^Remote\b/);
    const sp1 = new URL(page.url()).searchParams;
    expect([sp1.get("country"), sp1.get("remote")]).toEqual(["IN", "1"]);
    const remote = await countOf(page);
    expect(remote).toBeLessThan(india);

    await pick(page, /^Pay stated\b/);
    const sp2 = new URL(page.url()).searchParams;
    expect([sp2.get("country"), sp2.get("remote"), sp2.get("salary")]).toEqual(["IN", "1", "1"]);
    const final = await countOf(page);
    expect(final).toBeLessThan(remote);

    // the page and the public API agree on the same filter
    const api = await request.get("/api/public/jobs?remote=1&salary=1&country=IN&page_size=1");
    expect(api.status()).toBe(200);
    expect((await api.json()).total).toBe(final);
  });

  test("a job page opens from the ledger and its markdown variant is fetched", async ({ page, request }) => {
    await page.goto("/jobs");
    // Other specs seed short-lived e2e-* jobs, and the ledger is cached for 300 s, so skip those rows.
    const link = page.getByTestId("jobs-ledger").locator('a[href^="/job/"]:not([href^="/job/e2e-"])').first();
    await expect(link).toBeVisible();
    const href = (await link.getAttribute("href"))!;
    await link.click();
    await expect(page).toHaveURL(/\/job\/[a-z0-9-]+$/);
    await expect(page.getByTestId("job-title")).toBeVisible();

    const html = await request.get(href);
    // Next 15.5 overwrites Vary on rendered pages (build/templates/app-page: res.setHeader("Vary", ...)), so the HTML
    // side cannot carry Vary: Accept; the page is no-store, so no cache can serve it for a markdown request.
    expect(html.headers()["cache-control"]).toMatch(/no-store|private/);
    const htmlSize = (await html.body()).length;

    const negotiated = await request.get(href, { headers: { accept: "text/markdown" } });
    expect(negotiated.status()).toBe(200);
    expect(negotiated.headers()["content-type"]).toMatch(/^text\/markdown/);
    // a whole token: "Accept-Encoding" must not satisfy this
    expect(negotiated.headers()["vary"]).toMatch(/(^|,\s*)accept\s*(,|$)/i);
    const body = await negotiated.text();
    expect(body.length).toBeLessThanOrEqual(htmlSize * 0.3);

    const suffix = await request.get(`${href}.md`);
    expect(suffix.status()).toBe(200);
    expect(suffix.headers()["content-type"]).toMatch(/^text\/markdown/);
    expect(await suffix.text()).toBe(body);
  });

  test("saves the phase 3 screens from /jobs", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "screens are written once, from the desktop project");
    await page.goto("/jobs");
    await expect(page.getByTestId("jobs-ledger")).toBeVisible();
    await savePhaseScreen(page, 3);
    const paths = phaseScreenPaths(3);
    expect(existsSync(paths.desktop)).toBe(true);
    expect(existsSync(paths.mobile)).toBe(true);
  });
});
