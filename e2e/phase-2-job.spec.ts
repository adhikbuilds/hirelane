import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { cleanupJob, seedJob } from "../apps/web/e2e-support/seed-job";
import { MOBILE, phaseScreenPaths, savePhaseScreen } from "./support/screens";

let seed: Awaited<ReturnType<typeof seedJob>>;
test.beforeAll(async () => {
  seed = await seedJob();
});
test.afterAll(async () => {
  if (seed) await cleanupJob(seed.slug);
});

test.describe("phase 2 job page", () => {
  test("an INR LPA job shows its pay and a trace with the period and fx steps", async ({ page }) => {
    await page.goto(`/job/${seed.slug}`);
    await expect(page.getByTestId("job-title")).toHaveText(seed.jobTitle);
    await expect(page.getByTestId("salary")).toHaveText("₹18–25 L/yr");

    const trace = page.getByTestId("salary-trace");
    await trace.locator("summary").click();
    await expect(trace.locator('[data-step="Period"]').first()).toBeVisible();
    await expect(trace.locator('[data-step="FX"]').first()).toBeVisible();
    await expect(trace).toContainText("LPA means per annum");
    await expect(trace).toContainText("fixture snapshot");
    await expect(page.getByTestId("salary-equivalents")).toContainText("$");
  });

  test("splits requirements into must and nice with evidence, and lists skills, place and freshness", async ({ page }) => {
    await page.goto(`/job/${seed.slug}`);
    await expect(page.getByTestId("req-must")).toContainText("5+ years building pipelines in Python");
    await expect(page.getByTestId("req-nice")).toContainText("Airflow");
    await page.getByTestId("req-must").locator("summary").first().click();
    await expect(page.getByTestId("req-must").locator("mark")).toHaveText("5+ years building pipelines in Python");
    await expect(page.getByTestId("job-skills")).toContainText("Python");
    await expect(page.getByTestId("job-facts")).toContainText("IN");
    await expect(page.getByTestId("job-facts")).toContainText("Hybrid");
    await expect(page.getByTestId("job-freshness")).toContainText("3h ago");
  });

  test("has no horizontal overflow at 390px", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`/job/${seed.slug}`);
    await page.getByTestId("salary-trace").locator("summary").click();
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("an unknown or malformed slug is a 404", async ({ request }) => {
    expect((await request.get("/job/does-not-exist-zzz")).status()).toBe(404);
    expect((await request.get("/job/Bad%20Slug")).status()).toBe(404);
  });

  test("a /jobs row for an enriched posting links to its job page", async ({ page }) => {
    await page.goto("/jobs");
    const link = page.getByTestId("jobs-ledger").locator('a[href^="/job/"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/job\/[a-z0-9-]+$/);
    await expect(page.getByTestId("job-title")).toBeVisible();
  });

  test("saves the phase 2 screens", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "screens are written once, from the desktop project");
    await page.goto(`/job/${seed.slug}`);
    await page.getByTestId("salary-trace").locator("summary").click();
    await savePhaseScreen(page, 2);
    const paths = phaseScreenPaths(2);
    expect(existsSync(paths.desktop)).toBe(true);
    expect(existsSync(paths.mobile)).toBe(true);
  });
});
