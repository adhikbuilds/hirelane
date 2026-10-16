import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/dev/ui");
  // Hydrated once React tags the DOM; before that, clicks are lost.
  await expect
    .poll(() => page.getByRole("button", { name: "Approve and send" }).first().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))))
    .toBe(true);
}

test.describe("ui kit (/dev/ui)", () => {
  test("axe finds no serious or critical violations", async ({ page }) => {
    await ready(page);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });

  test("no horizontal overflow", async ({ page }) => {
    await ready(page);
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(o).toBeLessThanOrEqual(0);
  });

  test("combobox works by keyboard", async ({ page }) => {
    await ready(page);
    const box = page.getByRole("combobox", { name: "Company" });
    await box.focus();
    await page.keyboard.press("ArrowDown");
    await expect(box).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(box).toHaveValue("Stripe");
    await expect(page.getByTestId("combobox-value")).toHaveText("Selected: stripe");
  });

  test("undo bar: completes after 4 s, and U cancels", async ({ page }) => {
    await ready(page);
    const undoSection = page.getByRole("region", { name: "Undo bar" });
    await undoSection.getByRole("button", { name: "Approve and send" }).click();
    await expect(page.getByTestId("undo-countdown")).toBeVisible();
    await expect(page.getByTestId("undo-result")).toContainText("Handed off", { timeout: 6000 });
    await page.getByRole("button", { name: "Reset" }).click();
    await undoSection.getByRole("button", { name: "Approve and send" }).click();
    await page.keyboard.press("u");
    await expect(page.getByTestId("undo-result")).toContainText("Nothing was sent");
  });

  test("drop zone rejects a non-PDF and accepts a PDF, with no network request", async ({ page }) => {
    await ready(page);
    const uploads: string[] = [];
    page.on("request", (r) => r.method() !== "GET" && uploads.push(r.url()));
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByRole("alert").first()).toContainText("not a PDF");
    await input.setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%test") });
    await expect(page.getByRole("button", { name: /cv\.pdf/ })).toBeVisible();
    expect(uploads).toEqual([]);
  });

  test("slider and segmented control respond to the keyboard", async ({ page }) => {
    await ready(page);
    const thumb = page.getByRole("slider", { name: "Min match score" }).first();
    await thumb.focus();
    await page.keyboard.press("End");
    await expect(thumb).toHaveAttribute("aria-valuenow", "100");
    const weekly = page.getByRole("radio", { name: "Weekly" }).first();
    await weekly.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("radio", { name: "Quarterly" }).first()).toBeChecked();
  });

  test("marquee pauses on hover", async ({ page }) => {
    await ready(page);
    const track = page.locator(".marquee-track").first();
    await expect.poll(() => track.evaluate((el) => getComputedStyle(el).animationPlayState)).toBe("running");
    await page.locator(".marquee").first().hover();
    await expect.poll(() => track.evaluate((el) => getComputedStyle(el).animationPlayState)).toBe("paused");
  });

  test("marquee is a static row under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dev/ui");
    const track = page.locator(".marquee-track").first();
    await expect.poll(() => track.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    await expect(page.locator(".marquee-copy").nth(1)).toBeHidden();
  });

  test("a logo that fails to load becomes a monogram", async ({ page }) => {
    await ready(page);
    await expect(page.locator('img[src="/brand/does-not-exist.png"]')).toHaveCount(0);
  });

  test("the autopilot stats route answers and rejects bad input", async ({ request }) => {
    const ok = await request.get("/api/public/stats/autopilot?min=60&role=data-engineer");
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.perWeek).toBeGreaterThanOrEqual(0);
    expect(body.estimate.label).toBe("estimate");
    expect((await request.get("/api/public/stats/autopilot?min=101")).status()).toBe(400);
  });
});
