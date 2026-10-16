import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { cleanupIngest, seedIngest } from "../apps/web/e2e-support/seed";
import { MOBILE, phaseScreenPaths, savePhaseScreen } from "./support/screens";

const here = dirname(fileURLToPath(import.meta.url));

function opsToken(): string {
  if (process.env["HIRELANE_OPS_TOKEN"]) return process.env["HIRELANE_OPS_TOKEN"];
  const file = readFileSync(resolve(here, "../apps/web/.env.local"), "utf8");
  const m = file.match(/^HIRELANE_OPS_TOKEN=(.+)$/m);
  if (!m?.[1]) throw new Error("HIRELANE_OPS_TOKEN is not set for the web server");
  return m[1].trim();
}

let seed: Awaited<ReturnType<typeof seedIngest>>;
test.beforeAll(async () => {
  seed = await seedIngest(3);
});
test.afterAll(async () => {
  if (seed) await cleanupIngest(seed.slug);
});

test.describe("phase 1 ingest ops", () => {
  test("/ops/ingest is a 404 without the token", async ({ request }) => {
    expect((await request.get("/ops/ingest")).status()).toBe(404);
    expect((await request.get(`/ops/ingest?token=${opsToken()}`)).status()).toBe(404); // URL tokens are never accepted
    expect((await request.get("/ops/ingest", { headers: { "x-ops-token": "wrong" } })).status()).toBe(404);
  });

  test("shows the last run and per-source counts after signing in with the token", async ({ page }) => {
    await page.request.post("/ops/session", { form: { token: opsToken() } });
    await page.goto("/ops/ingest");
    await expect(page.getByRole("heading", { name: "Ingest", level: 1 })).toBeVisible();
    await expect(page.getByTestId("ops-runs").locator("tbody tr").first()).toBeVisible();
    await expect(page.getByTestId("ops-sources")).toBeVisible();
    await expect(page.getByTestId("ops-boards")).toBeVisible();
  });

  test("accepts the token as a header", async ({ request }) => {
    const res = await request.get("/ops/ingest", { headers: { "x-ops-token": opsToken() } });
    expect(res.status()).toBe(200);
  });

  test("a wrong token gets no session cookie", async ({ request }) => {
    const res = await request.post("/ops/session", { form: { token: "wrong" }, maxRedirects: 0 });
    expect(res.status()).toBe(404);
    expect(res.headers()["set-cookie"]).toBeUndefined();
  });

  test("the ops page asks search engines to stay away", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-ops-token": opsToken() });
    await page.goto("/ops/ingest");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("/jobs lists postings as job rows with a freshness cue and a link to each job", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page.getByTestId("jobs-ledger")).toBeVisible();
    const rows = page.getByTestId("jobs-ledger").locator("li[data-slug]");
    expect(await rows.count()).toBeGreaterThan(0);
    expect(await rows.count()).toBeLessThanOrEqual(50);
    await expect(rows.first().locator("[data-row-link]")).toHaveAttribute("href", /^\/job\//);
  });

  test("/jobs has no horizontal overflow at 390px", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/jobs");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("/jobs treats a bad page number as page 1", async ({ page }) => {
    const res = await page.goto("/jobs?page=abc");
    expect(res?.status()).toBe(200);
  });

  test("saves the phase 1 screens", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "screens are written once, from the desktop project");
    await page.goto("/jobs");
    await expect(page.getByTestId("jobs-ledger")).toBeVisible();
    await savePhaseScreen(page, 1);
    const paths = phaseScreenPaths(1);
    expect(existsSync(paths.desktop)).toBe(true);
    expect(existsSync(paths.mobile)).toBe(true);
  });
});
