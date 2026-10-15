import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { MOBILE, phaseScreenPaths, savePhaseScreen } from "./support/screens";

test.describe("phase 0 shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the wordmark", async ({ page }) => {
    await expect(page.getByRole("link", { name: "hirelane home" })).toBeVisible();
    await expect(page.getByText("hirelane", { exact: true }).first()).toBeVisible();
  });

  test("loads Overpass", async ({ page }) => {
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => document.fonts.check("16px Overpass"));
    const loadedFaces = await page.evaluate(
      () => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
    );
    expect(loaded, `fonts loaded: ${loadedFaces.join(", ")}`).toBe(true);
    expect(loadedFaces.some((f) => /overpass/i.test(f))).toBe(true);
  });

  test("uses the paper background", async ({ page }) => {
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(bg).toBe("rgb(243, 244, 241)");
  });

  test("health endpoint reports ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("has no horizontal overflow at 390px", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test("saves the phase 0 screens", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "screens are written once, from the desktop project");
    await savePhaseScreen(page, 0);
    const paths = phaseScreenPaths(0);
    expect(existsSync(paths.desktop)).toBe(true);
    expect(existsSync(paths.mobile)).toBe(true);
  });
});
